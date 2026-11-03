/**
 * 项目导出 API - 仅管理员可打包源码
 *
 * 两种打包模式：
 *  1) 工作目录模式（默认）：打包磁盘上当前 checkout 的文件（用系统 tar 流式打包）
 *     - scope=minimal      ~5MB   仅核心业务 src 目录
 *     - scope=source       ~15MB  纯源码 + 配置（排除 node_modules/.git/.next）
 *     - scope=with-assets  ~120MB 源码 + 上传资源 + 数据
 *     - scope=full         ~250MB 全项目（含 node_modules）
 *
 *  2) 指定分支模式：加 &branch=<分支名/ref/commit>，用 `git archive` 打包
 *     该分支【已提交】的源码（自动排除 node_modules/.git/未跟踪/构建产物），
 *     不受当前 checkout 状态影响。
 *     - /api/export-project?branch=stable           打包 stable 分支全部跟踪文件
 *     - /api/export-project?branch=stable&scope=minimal  仅 stable 的 src 目录
 */
import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { requireAdminUser } from '@/lib/server-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

const WORKDIR_SCOPES = [
  { scope: 'source', label: '源码', description: '纯项目源代码 + 配置文件，不含 node_modules', sizeEstimate: '~15 MB',
    args: ['--exclude=node_modules', '--exclude=.next', '--exclude=.git', '--exclude=uploads', '--exclude=public/uploads', '--exclude=scripts/download-iopaint-models.sh', '--exclude=upscayl-models', '--exclude=dist', '--exclude=.collab-dist', '.'] },
  { scope: 'with-assets', label: '含资源', description: '源码 + 上传资源 + 数据，不含 node_modules', sizeEstimate: '~120 MB',
    args: ['--exclude=node_modules', '--exclude=.next', '--exclude=.git', '--exclude=upscayl-models', '--exclude=dist', '--exclude=.collab-dist', '.'] },
  { scope: 'full', label: '完整项目', description: '整个项目全部文件，含 node_modules', sizeEstimate: '~250 MB', args: ['.'] },
  { scope: 'minimal', label: '最小核心', description: '仅核心业务 src 目录', sizeEstimate: '~5 MB', args: ['-C', './src', '.'] }
]

function streamResponse(proc: ReturnType<typeof spawn>, filename: string) {
  return new NextResponse(
    new ReadableStream({
      start(controller) {
        const stdout = proc.stdout
        const stderrChunks: Buffer[] = []
        proc.stderr?.on('data', (c: Buffer) => stderrChunks.push(c))

        stdout?.on('data', (chunk: Buffer) => {
          if (controller.desiredSize) controller.enqueue(chunk)
        })
        stdout?.on('end', () => {
          proc.on('close', (code) => {
            if (code === 0) controller.close()
            else controller.error(new Error(`打包进程退出码 ${code}: ${Buffer.concat(stderrChunks).toString().slice(0, 500)}`))
          })
        })
        proc.on('error', (err) => {
          console.error('[export-project] 进程错误:', err)
          controller.error(err)
        })
      }
    }),
    {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    }
  )
}

function createTarGz(scope: string, branch = ''): NextResponse | Promise<NextResponse> {
  const projectRoot = process.env.COZE_WORKSPACE_PATH || process.cwd()
  const date = new Date().toISOString().slice(0, 10)

  if (branch) {
    const verify = spawn('git', ['rev-parse', '--verify', '--quiet', branch], { cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'] })
    const verifyErr: Buffer[] = []
    verify.stderr?.on('data', (c: Buffer) => verifyErr.push(c))
    return new Promise<number>((resolve) => verify.on('close', resolve)).then(async (verifyCode) => {
      if (verifyCode !== 0) {
        const branches = spawn('git', ['branch', '--all'], { cwd: projectRoot, stdio: ['ignore', 'pipe', 'ignore'] })
        let branchList = ''
        branches.stdout?.on('data', (c: Buffer) => (branchList += c.toString()))
        await new Promise<void>((resolve) => branches.on('close', () => resolve()))
        return NextResponse.json({
          error: `分支或引用 "${branch}" 不存在`,
          availableBranches: branchList.split('\n').map(s => s.trim().replace(/^[*]\s*/, '')).filter(Boolean)
        }, { status: 404 })
      }

      const paths = scope === 'minimal' ? ['src', 'scripts'] : []
      const gitArgs = ['archive', '--format=tar.gz', `--prefix=wujie-${branch}/`, branch, ...paths]
      const proc = spawn('git', gitArgs, { cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'] })
      const suffix = scope === 'minimal' ? 'src' : 'source'
      return streamResponse(proc, `wujie-${branch}-${suffix}-${date}.tar.gz`)
    })
  }

  const target = WORKDIR_SCOPES.find(s => s.scope === scope)
  if (!target) {
    return NextResponse.json({ error: `无效 scope，支持: ${WORKDIR_SCOPES.map(s => s.scope).join(', ')}` }, { status: 400 })
  }

  const tarArgs = ['-czf', '-', ...target.args]
  const proc = spawn('tar', tarArgs, { cwd: projectRoot, stdio: ['ignore', 'pipe', 'inherit'] })
  return streamResponse(proc, `wujie-workdir-${scope}-${date}.tar.gz`)
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminUser(request)
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const scope = searchParams.get('scope') || 'source'
  const branch = searchParams.get('branch') || searchParams.get('ref') || ''

  // 无参数：返回使用说明
  if (!searchParams.get('scope') && !branch) {
    return NextResponse.json({
      message: '项目导出 API 可用',
      currentBranch: getCurrentBranch(),
      workdirScopes: WORKDIR_SCOPES.map(s => ({
        scope: s.scope, label: s.label, description: s.description,
        sizeEstimate: s.sizeEstimate, downloadUrl: `/api/export-project?scope=${s.scope}`
      })),
      branchMode: {
        description: '用 git archive 打包指定分支【已提交】的源码（自动排除 node_modules/.git/未跟踪文件）',
        examples: [
          '/api/export-project?branch=stable',
          '/api/export-project?branch=stable&scope=minimal',
          '/api/export-project?branch=main-fix',
          '/api/export-project?branch=<commit-hash>'
        ]
      }
    })
  }

  if (branch) return createTarGz(scope, branch)
  return createTarGz(scope)
}

function getCurrentBranch(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execSync } = require('child_process')
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: process.env.COZE_WORKSPACE_PATH || process.cwd() }).toString().trim()
  } catch {
    return 'unknown'
  }
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminUser(request)
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const scope = body.scope || 'source'
  const branch = body.branch || body.ref || ''
  if (branch) return createTarGz(scope, branch)
  return createTarGz(scope)
}
