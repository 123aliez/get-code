/**
 * get-code HTTP 服务
 * 将验证码获取功能封装为 HTTP API
 * 端口: 8003
 */

const http = require('http')
const fs = require('fs')
const { spawn } = require('child_process')
const path = require('path')

const PORT = 8003
const SCRIPT = path.join(__dirname, 'get-code.js')
const NODE = process.execPath

// 活跃任务追踪
const activeTasks = new Map()
let taskIdCounter = 0

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url, `http://${req.headers.host}`)

  // 健康检查
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status: 'ok',
      service: 'get-code',
      activeTasks: activeTasks.size,
      uptime: process.uptime()
    }))
    return
  }

  // 静态文件服务 - 前端页面
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const filePath = path.join(__dirname, 'public', 'index.html')
    try {
      const html = fs.readFileSync(filePath, 'utf-8')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('页面文件不存在')
    }
    return
  }

  // 其他静态资源 (public 目录)
  if (url.pathname.startsWith('/assets/')) {
    const filePath = path.join(__dirname, 'public', url.pathname)
    const extMap = {
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
    }
    const ext = path.extname(filePath)
    const contentType = extMap[ext] || 'application/octet-stream'
    try {
      const data = fs.readFileSync(filePath)
      res.writeHead(200, { 'Content-Type': contentType })
      res.end(data)
    } catch {
      res.writeHead(404)
      res.end('Not Found')
    }
    return
  }

  // 获取验证码 API
  if (url.pathname === '/api/get-code' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        const { account, options } = data

        if (!account) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: '缺少 account 参数，格式: 邮箱----密码----clientId----refreshToken' }))
          return
        }

        const taskId = ++taskIdCounter
        const args = [SCRIPT, account]
        if (options) args.push(JSON.stringify(options))

        const logs = []
        let code = null
        let finished = false

        const child = spawn(NODE, args, {
          cwd: __dirname,
          timeout: 150000, // 2.5分钟超时
          env: { ...process.env }
        })

        const task = { id: taskId, child, startTime: Date.now() }
        activeTasks.set(taskId, task)

        child.stdout.on('data', chunk => {
          const text = chunk.toString()
          logs.push(text)
          // 尝试提取验证码
          const match = text.match(/===== 验证码: (\S+) =====/)
          if (match) code = match[1]
        })

        child.stderr.on('data', chunk => {
          logs.push('[stderr] ' + chunk.toString())
        })

        child.on('close', (exitCode) => {
          finished = true
          activeTasks.delete(taskId)
          // 如果 SSE 模式下响应已结束则不处理
        })

        // 判断是否使用 SSE 流式返回
        const useSSE = data.stream === true || url.searchParams.get('stream') === 'true'

        if (useSSE) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          })

          res.write(`data: ${JSON.stringify({ type: 'start', taskId })}\n\n`)

          child.stdout.on('data', chunk => {
            res.write(`data: ${JSON.stringify({ type: 'log', text: chunk.toString() })}\n\n`)
          })

          child.stderr.on('data', chunk => {
            res.write(`data: ${JSON.stringify({ type: 'log', text: '[stderr] ' + chunk.toString() })}\n\n`)
          })

          child.on('close', (exitCode) => {
            res.write(`data: ${JSON.stringify({ type: 'done', code, exitCode, taskId })}\n\n`)
            res.end()
          })

          res.on('close', () => {
            if (!finished) {
              child.kill('SIGTERM')
              activeTasks.delete(taskId)
            }
          })
        } else {
          // 同步等待结果
          child.on('close', (exitCode) => {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              taskId,
              code,
              exitCode,
              logs: logs.join(''),
              duration: Date.now() - task.startTime
            }))
          })
        }

      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: '请求解析失败: ' + e.message }))
      }
    })
    return
  }

  // 查询活跃任务
  if (url.pathname === '/api/tasks') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    const tasks = []
    for (const [id, task] of activeTasks) {
      tasks.push({ id, running: Date.now() - task.startTime })
    }
    res.end(JSON.stringify({ tasks }))
    return
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not Found' }))
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[get-code] 服务启动，监听 127.0.0.1:${PORT}`)
})

// 优雅退出
process.on('SIGTERM', () => {
  console.log('[get-code] 收到 SIGTERM，正在关闭...')
  for (const [, task] of activeTasks) {
    task.child.kill('SIGTERM')
  }
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 5000)
})

process.on('SIGINT', () => {
  console.log('[get-code] 收到 SIGINT，正在关闭...')
  server.close(() => process.exit(0))
})
