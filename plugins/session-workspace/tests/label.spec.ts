/** 工作区路径末级目录名的取值规则测试：Windows/POSIX 分隔符、根路径与异常输入。 */

import { describe, expect, it } from 'vitest'
import { workspaceLabel } from '../src/client/label.js'

describe('workspaceLabel', () => {
  it('takes the last segment of a Windows path', () => {
    expect(workspaceLabel('D:\\Documents\\ai-dev\\dsh-kit')).toBe('dsh-kit')
  })

  it('takes the last segment of a POSIX path', () => {
    expect(workspaceLabel('/home/user/project')).toBe('project')
  })

  it('absorbs trailing and repeated separators', () => {
    expect(workspaceLabel('/srv/data/')).toBe('data')
    expect(workspaceLabel('D:\\\\repo\\\\\\\\nested')).toBe('nested')
  })

  it('takes the share name of a UNC path', () => {
    expect(workspaceLabel('\\\\server\\share\\repo')).toBe('repo')
  })

  it('falls back to the drive segment for a drive root', () => {
    expect(workspaceLabel('D:\\')).toBe('D:')
    expect(workspaceLabel('/')).toBe('/')
  })

  it('returns the input unchanged when no non-empty segment exists', () => {
    expect(workspaceLabel('\\')).toBe('\\')
  })
})
