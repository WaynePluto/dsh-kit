import { describe, expect, it } from 'vitest'
import { withSshKeepAlive } from '../src/interactive-terminal-tools.js'

describe('SSH keepalive command defaults', () => {
  it('adds both defaults to direct OpenSSH commands', () => {
    expect(withSshKeepAlive('ssh user@server')).toBe(
      'ssh -o ServerAliveInterval=15 -o ServerAliveCountMax=3 user@server',
    )
    expect(withSshKeepAlive('  ssh.exe -p 2222 user@server')).toBe(
      '  ssh.exe -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -p 2222 user@server',
    )
  })

  it('preserves explicit option values and fills only missing defaults', () => {
    expect(withSshKeepAlive('ssh -o ServerAliveInterval=60 user@server')).toBe(
      'ssh -o ServerAliveCountMax=3 -o ServerAliveInterval=60 user@server',
    )
    expect(withSshKeepAlive('ssh -oServerAliveCountMax=8 user@server')).toBe(
      'ssh -o ServerAliveInterval=15 -oServerAliveCountMax=8 user@server',
    )
    expect(withSshKeepAlive('ssh -o "ServerAliveInterval 30" -o "ServerAliveCountMax 5" user@server')).toBe(
      'ssh -o "ServerAliveInterval 30" -o "ServerAliveCountMax 5" user@server',
    )
  })

  it('leaves non-direct SSH commands unchanged', () => {
    expect(withSshKeepAlive('pwsh -Command "ssh user@server"')).toBe('pwsh -Command "ssh user@server"')
    expect(withSshKeepAlive('echo ssh user@server')).toBe('echo ssh user@server')
  })
})
