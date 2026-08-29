import assert from 'node:assert/strict'
import test from 'node:test'
import { buildVsCodeOpenCommandAttempts } from './vscode-open-command'

test('buildVsCodeOpenCommandAttempts includes PATH, absolute-path, and macOS app fallbacks', () => {
  const commands = buildVsCodeOpenCommandAttempts()
  const directCodeCommand = "command -v code >/dev/null 2>&1 && code --reuse-window '.'"
  const macOpenCommand = "command -v open >/dev/null 2>&1 && open -Ra \"Visual Studio Code\" && open -a \"Visual Studio Code\" '.'"

  assert.equal(commands[0], directCodeCommand)
  assert.ok(commands.includes("[ -x \"/opt/homebrew/bin/code\" ] && \"/opt/homebrew/bin/code\" --reuse-window '.'"))
  assert.ok(commands.includes("[ -x \"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code\" ] && \"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code\" --reuse-window '.'"))
  assert.ok(commands.includes(macOpenCommand))
  assert.ok(commands.includes("command -v code-insiders >/dev/null 2>&1 && code-insiders --reuse-window '.'"))
  assert.ok(commands.includes("command -v open >/dev/null 2>&1 && open -Ra \"Visual Studio Code - Insiders\" && open -a \"Visual Studio Code - Insiders\" '.'"))
  assert.ok(commands.indexOf(directCodeCommand) < commands.indexOf(macOpenCommand))
})

test('buildVsCodeOpenCommandAttempts trims unrelated platform fallbacks', () => {
  const macCommands = buildVsCodeOpenCommandAttempts({ platform: 'darwin' })
  const linuxCommands = buildVsCodeOpenCommandAttempts({ platform: 'linux' })

  assert.ok(macCommands.every((command) => !command.includes('/snap/bin/')))
  assert.ok(macCommands.some((command) => command.includes('/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code')))
  assert.ok(macCommands.some((command) => command.includes('open -a "Visual Studio Code"')))

  assert.ok(linuxCommands.every((command) => !command.includes('.app/Contents/Resources/app/bin/')))
  assert.ok(linuxCommands.every((command) => !command.includes('open -a "Visual Studio Code"')))
  assert.ok(linuxCommands.some((command) => command.includes('/snap/bin/code')))
})
