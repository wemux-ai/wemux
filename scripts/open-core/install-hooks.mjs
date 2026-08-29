#!/usr/bin/env node
// [INPUT]: current Git worktree
// [OUTPUT]: repository-local hooks enabled

import { execFileSync } from 'node:child_process'

execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' })
console.log('Installed Wemux Open Core hooks at .githooks')
