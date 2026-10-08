//go:build windows

package main

import (
	"log"
	"syscall"
	"unsafe"
)

// 初始位置夹取只用 user32 的少量调用。按标题找主窗口的语义与
// singleinstance_windows.go 一致，但枚举时复核 pid：dev 实例与 attach 实例
// 可同时运行且标题相同，不能像激活已有窗口那样只认标题。
var (
	windowClampUser32 = syscall.NewLazyDLL("user32.dll")

	windowClampEnumWindows       = windowClampUser32.NewProc("EnumWindows")
	windowClampGetWindowThreadID = windowClampUser32.NewProc("GetWindowThreadProcessId")
	windowClampTextLength        = windowClampUser32.NewProc("GetWindowTextLengthW")
	windowClampGetWindowText     = windowClampUser32.NewProc("GetWindowTextW")
	windowClampMonitorFromWindow = windowClampUser32.NewProc("MonitorFromWindow")
	windowClampGetMonitorInfo    = windowClampUser32.NewProc("GetMonitorInfoW")
	windowClampGetWindowRect     = windowClampUser32.NewProc("GetWindowRect")
	windowClampSetWindowPos      = windowClampUser32.NewProc("SetWindowPos")

	windowClampProc = syscall.NewCallback(windowClampEnumProc)
)

const (
	windowClampMonitorDefaultToNearest = 2

	windowClampSwpNoSize     = 0x0001
	windowClampSwpNoZOrder   = 0x0004
	windowClampSwpNoActivate = 0x0010
)

// windowClampRect 对应 Win32 RECT；windowClampMonitorInfo 对应 MONITORINFO，
// 成员全为 4 字节，自然布局即 ABI 布局。
type windowClampRect struct {
	left, top, right, bottom int32
}

type windowClampMonitorInfo struct {
	cbSize    uint32
	rcMonitor windowClampRect
	rcWork    windowClampRect
	dwFlags   uint32
}

// windowClampWantedTitle / windowClampFoundWindow 承载枚举条件与结果；
// EnumWindows 同步回调，不经 lParam 传指针（vet 禁止 uintptr 反解引用）。
var (
	windowClampWantedTitle string
	windowClampFoundWindow uintptr
)

// windowClampEnumProc 找到本进程指定标题的顶层窗口（Wails 主窗口），
// 记录后返回 0 停止枚举；不看可见性，OnStartup 时窗口尚未显示。
func windowClampEnumProc(hwnd uintptr, _ uintptr) uintptr {
	var pid uint32
	windowClampGetWindowThreadID.Call(hwnd, uintptr(unsafe.Pointer(&pid)))
	if pid != uint32(syscall.Getpid()) {
		return 1
	}
	if windowClampWindowTitle(hwnd) != windowClampWantedTitle {
		return 1
	}
	windowClampFoundWindow = hwnd
	return 0
}

// windowClampWindowTitle 读取顶层窗口标题，空标题窗口返回空串；
// 缓冲区大小用 GetWindowTextLengthW 预取（GetWindowTextW 不保证
// NULL 缓冲区时返回所需长度）。
func windowClampWindowTitle(hwnd uintptr) string {
	length, _, _ := windowClampTextLength.Call(hwnd)
	if length == 0 {
		return ""
	}
	buf := make([]uint16, length+1)
	loaded, _, _ := windowClampGetWindowText.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	return syscall.UTF16ToString(buf[:loaded])
}

// windowClampTargetY 裁决窗口顶部是否越出工作区顶部：越出时返回贴齐
// 工作区顶部的新 Y。窗口比工作区高时也只保证顶部回到可见区域，
// 不处理底部越界（标题栏可见即可拖动）。
func windowClampTargetY(windowTop, workTop int32) (int32, bool) {
	if windowTop >= workTop {
		return 0, false
	}
	return workTop, true
}

// clampInitialWindowTop 把主窗口顶部夹回所在显示器的工作区顶部。Wails
// 启动固定在工作区垂直居中（winc Form.Center），窗口高度超过工作区高度
// （低分辨率或高 DPI 缩放屏）时居中结果 top 为负，自绘标题栏整个移出
// 屏幕外、窗口无法拖动。必须在 WindowShow 之前调用：此时居中已完成且
// 窗口仍隐藏，用户看不到越位位置。找不到窗口或显示器信息时保持原位。
func clampInitialWindowTop(title string) {
	windowClampWantedTitle = title
	windowClampFoundWindow = 0
	windowClampEnumWindows.Call(windowClampProc, 0)
	hwnd := windowClampFoundWindow
	if hwnd == 0 {
		log.Printf("未找到标题为 %q 的主窗口，跳过初始位置夹取", title)
		return
	}
	monitor, _, _ := windowClampMonitorFromWindow.Call(hwnd, windowClampMonitorDefaultToNearest)
	if monitor == 0 {
		return
	}
	info := windowClampMonitorInfo{cbSize: uint32(unsafe.Sizeof(windowClampMonitorInfo{}))}
	if ok, _, _ := windowClampGetMonitorInfo.Call(monitor, uintptr(unsafe.Pointer(&info))); ok == 0 {
		return
	}
	rect := windowClampRect{}
	if ok, _, _ := windowClampGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&rect))); ok == 0 {
		return
	}
	targetY, move := windowClampTargetY(rect.top, info.rcWork.top)
	if !move {
		return
	}
	windowClampSetWindowPos.Call(hwnd, 0, uintptr(rect.left), uintptr(targetY), 0, 0,
		windowClampSwpNoSize|windowClampSwpNoZOrder|windowClampSwpNoActivate)
}
