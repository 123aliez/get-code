/**
 * 通用验证码获取脚本（通过 Python Outlook 收件脚本桥接）
 *
 * 用法：
 * 1) node get-code.js "邮箱----密码----clientId----refreshToken"
 * 2) node get-code.js "邮箱----密码----clientId----refreshToken" '{"searchMinutes":30}'
 */

const readline = require('readline')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const PYTHON = process.env.PYTHON || 'python3'
const MAIL_FETCHER = '/home/ccweb/outreg/Outlook-GPT-REG/mail_fetcher.py'

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

function parseIntInRange(input, min, max, fallback) {
  const n = parseInt(input, 10)
  if (Number.isNaN(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function parseDigitsRange(input) {
  if (!input) return { min: 4, max: 8 }
  const m = input.match(/^(\d+)\s*-\s*(\d+)$/)
  if (m) {
    const min = Math.max(3, parseInt(m[1], 10))
    const max = Math.min(10, parseInt(m[2], 10))
    if (min <= max) return { min, max }
  }
  const n = parseInt(input, 10)
  if (!Number.isNaN(n)) return { min: Math.max(3, n), max: Math.min(10, n) }
  return { min: 4, max: 8 }
}

function extractCodes(text, minDigits, maxDigits) {
  const pattern = new RegExp(`\\b(\\d{${minDigits},${maxDigits}})\\b`, 'g')
  return Array.from(text.matchAll(pattern), match => match[1])
}

function selectCode(messages, minDigits, maxDigits, senderFilters, subjectFilters) {
  for (const msg of messages) {
    const from = String(msg.from || '').toLowerCase()
    const subject = String(msg.subject || '').toLowerCase()
    const body = String(msg.body || '')

    if (senderFilters.length > 0 && !senderFilters.some(k => from.includes(k))) continue
    if (subjectFilters.length > 0 && !subjectFilters.some(k => subject.includes(k))) continue

    const combined = `${msg.subject || ''}\n${body}`
    const codes = Array.isArray(msg.codes) && msg.codes.length > 0
      ? msg.codes.map(String)
      : extractCodes(combined, minDigits, maxDigits)

    const code = codes.find(item => item.length >= minDigits && item.length <= maxDigits)
    if (code) {
      return {
        code,
        from,
        subject: msg.subject || '',
        date: msg.date || '',
      }
    }
  }
  return null
}

function runMailFetcher(account, runtimeOptions) {
  return new Promise((resolve, reject) => {
    const searchMinutes = runtimeOptions.searchMinutes
    const limit = Math.max(20, Math.min(200, runtimeOptions.scanLimitPerFolder))
    const timeout = Math.max(20, Math.min(120, runtimeOptions.timeoutSeconds))
    const jsonOutput = path.join('/tmp', `get-code-${process.pid}-${Date.now()}.json`)

    const args = [
      MAIL_FETCHER,
      '--protocol', 'imap',
      '--account-line', account,
      '--host', 'outlook.office365.com',
      '--port', '993',
      '--limit', String(limit),
      '--timeout', String(timeout),
      '--retries', '1',
      '--preview-chars', '0',
      '--json-output', jsonOutput,
      '--all',
    ]

    const child = spawn(PYTHON, args, {
      cwd: path.dirname(MAIL_FETCHER),
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', chunk => {
      const text = chunk.toString()
      stdout += text
      process.stdout.write(text)
    })

    child.stderr.on('data', chunk => {
      const text = chunk.toString()
      stderr += text
      process.stderr.write(text)
    })

    child.on('error', reject)

    child.on('close', exitCode => {
      let messages = []
      try {
        if (fs.existsSync(jsonOutput)) {
          messages = JSON.parse(fs.readFileSync(jsonOutput, 'utf-8'))
          fs.unlinkSync(jsonOutput)
        }
      } catch (e) {
        stderr += `\n读取 JSON 结果失败: ${e.message}\n`
      }

      resolve({ exitCode, stdout, stderr, messages, searchMinutes })
    })
  })
}

async function fetchCode(account, senderFilters, subjectFilters, runtimeOptions) {
  const { min, max } = parseDigitsRange(runtimeOptions.digits)
  console.log(`\n验证码位数: ${min}-${max}`)
  console.log(`搜索窗口: 最近${runtimeOptions.searchMinutes}分钟`)
  console.log(`单次拉取上限: ${Math.max(20, Math.min(200, runtimeOptions.scanLimitPerFolder))}封`)
  console.log(`轮询超时: ${runtimeOptions.timeoutSeconds}秒`)
  if (senderFilters.length > 0) console.log(`发件人过滤: ${senderFilters.join(', ')}`)
  if (subjectFilters.length > 0) console.log(`主题过滤: ${subjectFilters.join(', ')}`)
  console.log('正在调用 Python 收件脚本...')

  const result = await runMailFetcher(account, runtimeOptions)
  const cutoff = Date.now() - result.searchMinutes * 60 * 1000
  const recentMessages = result.messages.filter(msg => {
    const ts = Date.parse(msg.date || '')
    return Number.isNaN(ts) ? true : ts >= cutoff
  })

  console.log(`最近${result.searchMinutes}分钟候选邮件: ${recentMessages.length} 封`)

  const picked = selectCode(recentMessages, min, max, senderFilters, subjectFilters)
  if (picked) {
    console.log(`\n发件人: ${picked.from}`)
    console.log(`主题: ${picked.subject}`)
    console.log(`接收时间: ${picked.date}`)
    console.log(`\n===== 验证码: ${picked.code} =====\n`)
    return picked.code
  }

  if (result.exitCode !== 0) {
    console.log(`Python 收件脚本退出码: ${result.exitCode}`)
  }

  console.log(`超时（${runtimeOptions.timeoutSeconds}秒），未找到验证码`)
  return null
}

async function main() {
  let input = process.argv[2]

  if (!input) {
    console.log('请粘贴账号信息，格式: 邮箱----密码----clientId----refreshToken')
    input = await ask('> ')
  }

  const parts = input.includes('----') ? input.split('----') : input.split('|')
  if (parts.length < 4) {
    console.log('格式错误，需要: 邮箱----密码----clientId----refreshToken')
    return
  }

  const [email] = parts
  let senderFilters = []
  let subjectFilters = []
  let digitsInput = '4-8'
  let searchMinutes = 30
  let timeoutSeconds = 150
  let scanLimitPerFolder = 120

  const optionsArg = process.argv[3]
  if (optionsArg) {
    try {
      const options = JSON.parse(optionsArg)
      if (options.sender) {
        senderFilters = String(options.sender)
          .split(',')
          .map(s => s.trim().toLowerCase())
          .filter(Boolean)
      }
      if (options.subject) {
        subjectFilters = String(options.subject)
          .split(',')
          .map(s => s.trim().toLowerCase())
          .filter(Boolean)
      }
      if (options.digits) digitsInput = String(options.digits)
      if (options.searchMinutes != null) {
        searchMinutes = parseIntInRange(options.searchMinutes, 1, 1440, searchMinutes)
      }
      if (options.timeoutSeconds != null) {
        timeoutSeconds = parseIntInRange(options.timeoutSeconds, 30, 900, timeoutSeconds)
      }
      if (options.scanLimitPerFolder != null) {
        scanLimitPerFolder = parseIntInRange(options.scanLimitPerFolder, 20, 2000, scanLimitPerFolder)
      }
    } catch {
      console.log('第3个参数不是合法 JSON，已使用默认配置')
    }
  }

  console.log(`\n邮箱: ${email}`)

  await fetchCode(input, senderFilters, subjectFilters, {
    digits: digitsInput,
    searchMinutes,
    timeoutSeconds,
    scanLimitPerFolder,
  })
}

main().catch(error => {
  console.error(error?.stack || String(error))
  process.exit(1)
})
