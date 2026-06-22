/**
 * 检查本地 AI 模型文件状态和 Python 虚拟环境
 * 此文件独立于 instrumentation.ts，避免 Edge Runtime 加载 Node.js 模块
 * 使用异步 exec 代替 execSync，避免阻塞 Node.js 事件循环导致启动超时
 */
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

export async function checkLocalModels() {
  try {
    const localAiEnabled = process.env.LOCAL_AI_ENABLED;
    if (localAiEnabled === 'false') {
      console.log('[instrumentation] LOCAL_AI_ENABLED is false, skipping model check');
      return;
    }

    const workspacePath = process.env.COZE_WORKSPACE_PATH || '/workspace/projects';
    
    // 优先使用 /space 持久存储目录（S3，沙箱重建后不丢失）
    const iopaintDir = process.env.IOPAINT_MODELS_DIR ||
      (fs.existsSync('/space/iopaint-models') ? '/space/iopaint-models' : path.join(workspacePath, 'models', 'iopaint'));
    const removebgDir = process.env.REMOVEBG_MODELS_DIR ||
      (fs.existsSync('/space/removebg-models') ? '/space/removebg-models' : path.join(workspacePath, 'models', 'removebg'));

    // ─── 检查 Python 虚拟环境 ─────────────────────────────
    // 优先级: PYTHON_BIN 环境变量 > /space/python-venv (持久) > .venv (临时) > 系统 python3
    const spaceVenvPython = '/space/python-venv/bin/python3';
    const projectVenvPython = path.join(workspacePath, '.venv', 'bin', 'python3');
    const venvPython = process.env.PYTHON_BIN ||
      (fs.existsSync(spaceVenvPython) ? spaceVenvPython :
       fs.existsSync(projectVenvPython) ? projectVenvPython : 'python3');

    // 使用异步 exec 检查 Python 环境，不阻塞事件循环
    const checkPythonEnv = (cmd: string): Promise<boolean> => {
      return new Promise((resolve) => {
        exec(cmd, { timeout: 10000 }, (err) => {
          resolve(!err);
        });
      });
    };

    let pythonOk = false;
    try {
      if (fs.existsSync(venvPython)) {
        pythonOk = await checkPythonEnv(`${venvPython} -c "import torch; import iopaint"`);
        if (pythonOk) {
          console.log(`[instrumentation] Python venv OK (${venvPython})`);
        } else {
          console.warn(
            `[instrumentation] Python 环境不可用 (torch/iopaint 缺失)\n` +
            `  请运行: bash scripts/setup-venv.sh\n` +
            `  本地 AI 功能将降级到 API 兜底`
          );
        }
      } else {
        console.warn(`[instrumentation] Python venv not found at ${venvPython}, trying system python3...`);
        pythonOk = await checkPythonEnv('python3 -c "import torch; import iopaint"');
        if (pythonOk) {
          console.log('[instrumentation] System python3 + torch + iopaint available (non-persistent!)');
        } else {
          console.warn(
            `[instrumentation] Python 环境不可用 (torch/iopaint 缺失)\n` +
            `  请运行: bash scripts/setup-venv.sh\n` +
            `  本地 AI 功能将降级到 API 兜底`
          );
        }
      }
    } catch {
      console.warn(
        `[instrumentation] Python 环境不可用 (torch/iopaint 缺失)\n` +
        `  请运行: bash scripts/setup-venv.sh\n` +
        `  本地 AI 功能将降级到 API 兜底`
      );
    }

    // ─── 检查核心模型文件 ────────────────────────────────
    const coreModels = [
      { name: 'LaMa 擦除', path: path.join(iopaintDir, 'big-lama.pt'), minSize: 1_000_000 },
      { name: 'U2Net 去背景(推荐)', path: path.join(removebgDir, 'u2net.onnx'), minSize: 100_000_000 },
      { name: 'ISNet 去背景', path: path.join(removebgDir, 'isnet-general-use.onnx'), minSize: 100_000_000 },
      { name: 'U2NetP 去背景', path: path.join(removebgDir, 'u2netp.onnx'), minSize: 1_000_000 },
    ];

    const missing: string[] = [];
    for (const model of coreModels) {
      try {
        const stat = fs.statSync(model.path);
        if (stat.size < model.minSize) {
          missing.push(`${model.name} (${model.path} 文件过小: ${stat.size} bytes)`);
        }
      } catch {
        missing.push(`${model.name} (${model.path} 不存在)`);
      }
    }

    if (missing.length > 0) {
      console.warn(
        `[instrumentation] 本地 AI 模型缺失:\n${missing.map(m => `  - ${m}`).join('\n')}\n` +
        `  请运行: bash scripts/ensure-models.sh --download\n` +
        `  模型目录: IOPaint=${iopaintDir}, RemoveBG=${removebgDir}\n` +
        `  缺失模型将自动降级到 AI API 兜底`
      );
    } else if (pythonOk) {
      console.log('[instrumentation] 本地 AI 环境完全就绪 (Python venv + 模型)');
    } else {
      console.log('[instrumentation] 模型文件就绪，但 Python 环境缺失');
    }
  } catch (e) {
    // 模型检查失败不应影响应用启动
    console.warn('[instrumentation] Model check failed (non-fatal):', e);
  }
}
