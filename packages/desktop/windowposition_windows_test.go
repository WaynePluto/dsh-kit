//go:build windows

package main

import (
	"runtime"
	"syscall"
	"testing"
	"unsafe"
)

func TestWindowClampTargetY(t *testing.T) {
	cases := []struct {
		name      string
		windowTop int32
		workTop   int32
		wantY     int32
		wantMove  bool
	}{
		{"主显示器居中越出顶部", -117, 0, 0, true},
		{"任务栏在上时压住任务栏", 20, 48, 48, true},
		{"上方副显示器的负坐标", -1200, -1080, -1080, true},
		{"正好贴住工作区顶部", 48, 48, 0, false},
		{"窗口在工作区内", 200, 48, 0, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			gotY, gotMove := windowClampTargetY(c.windowTop, c.workTop)
			if gotY != c.wantY || gotMove != c.wantMove {
				t.Fatalf("windowClampTargetY(%d, %d) = (%d, %v)，期望 (%d, %v)",
					c.windowTop, c.workTop, gotY, gotMove, c.wantY, c.wantMove)
			}
		})
	}
}

// windowClampTestWindow 用预定义 STATIC 类创建带标题的隐藏顶层窗口：
// 不注册窗口类、不进消息循环，只作为位置夹取的定位目标；销毁必须回到
// 创建线程，测试全程 LockOSThread。
func windowClampTestWindow(t *testing.T, title string) uintptr {
	t.Helper()
	instance, _, _ := desktopTrayGetModuleHandle.Call(0)
	class, _ := syscall.UTF16PtrFromString("STATIC")
	name, err := syscall.UTF16PtrFromString(title)
	if err != nil {
		t.Fatal(err)
	}
	const wsOverlappedWindow = 0x00CF0000
	hwnd, _, callErr := desktopTrayCreateWindow.Call(
		0, uintptr(unsafe.Pointer(class)), uintptr(unsafe.Pointer(name)),
		wsOverlappedWindow, 0, 0, 400, 300, 0, 0, instance, 0,
	)
	if hwnd == 0 {
		t.Fatal(desktopTrayError("CreateWindowExW", callErr))
	}
	t.Cleanup(func() { desktopTrayDestroyWindow.Call(hwnd) })
	return hwnd
}

// windowClampTestWorkAndRect 读取窗口所在显示器工作区与当前窗口矩形。
func windowClampTestWorkAndRect(t *testing.T, hwnd uintptr) (windowClampRect, windowClampRect) {
	t.Helper()
	monitor, _, _ := windowClampMonitorFromWindow.Call(hwnd, windowClampMonitorDefaultToNearest)
	if monitor == 0 {
		t.Fatal("MonitorFromWindow 失败")
	}
	info := windowClampMonitorInfo{cbSize: uint32(unsafe.Sizeof(windowClampMonitorInfo{}))}
	if ok, _, _ := windowClampGetMonitorInfo.Call(monitor, uintptr(unsafe.Pointer(&info))); ok == 0 {
		t.Fatal("GetMonitorInfoW 失败")
	}
	rect := windowClampRect{}
	if ok, _, callErr := windowClampGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&rect))); ok == 0 {
		t.Fatal(desktopTrayError("GetWindowRect", callErr))
	}
	return info.rcWork, rect
}

func windowClampTestMove(t *testing.T, hwnd uintptr, x, y int32) {
	t.Helper()
	if ok, _, callErr := windowClampSetWindowPos.Call(hwnd, 0, uintptr(x), uintptr(y), 0, 0,
		windowClampSwpNoSize|windowClampSwpNoZOrder|windowClampSwpNoActivate); ok == 0 {
		t.Fatal(desktopTrayError("SetWindowPos", callErr))
	}
}

func TestClampInitialWindowTopMovesWindowAboveWorkArea(t *testing.T) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	const title = "dsh-station 窗口位置夹取测试 越出"
	hwnd := windowClampTestWindow(t, title)
	work, _ := windowClampTestWorkAndRect(t, hwnd)
	windowClampTestMove(t, hwnd, work.left+50, work.top-120)
	work, before := windowClampTestWorkAndRect(t, hwnd)
	if before.top >= work.top {
		t.Skipf("当前显示器布局无法构造越出工作区顶部的窗口（top=%d，workTop=%d）", before.top, work.top)
	}
	clampInitialWindowTop(title)
	_, after := windowClampTestWorkAndRect(t, hwnd)
	if after.top != work.top {
		t.Fatalf("夹取后窗口 top = %d，期望贴齐工作区顶部 %d", after.top, work.top)
	}
	if after.left != before.left {
		t.Fatalf("夹取改变了水平位置：%d → %d", before.left, after.left)
	}
}

func TestClampInitialWindowTopKeepsWindowInsideWorkArea(t *testing.T) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	const title = "dsh-station 窗口位置夹取测试 区内"
	hwnd := windowClampTestWindow(t, title)
	work, _ := windowClampTestWorkAndRect(t, hwnd)
	windowClampTestMove(t, hwnd, work.left+50, work.top+50)
	_, before := windowClampTestWorkAndRect(t, hwnd)
	clampInitialWindowTop(title)
	_, after := windowClampTestWorkAndRect(t, hwnd)
	if after.top != before.top || after.left != before.left {
		t.Fatalf("工作区内的窗口不应被移动：(%d,%d) → (%d,%d)",
			before.left, before.top, after.left, after.top)
	}
}

func TestClampInitialWindowTopIgnoresUnknownTitle(t *testing.T) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	const title = "dsh-station 窗口位置夹取测试 忽略"
	hwnd := windowClampTestWindow(t, title)
	work, _ := windowClampTestWorkAndRect(t, hwnd)
	windowClampTestMove(t, hwnd, work.left+50, work.top+50)
	_, before := windowClampTestWorkAndRect(t, hwnd)
	clampInitialWindowTop("dsh-station 窗口位置夹取测试 不存在的标题")
	_, after := windowClampTestWorkAndRect(t, hwnd)
	if after.top != before.top || after.left != before.left {
		t.Fatalf("标题不匹配时不应移动任何窗口：(%d,%d) → (%d,%d)",
			before.left, before.top, after.left, after.top)
	}
}
