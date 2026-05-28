'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * 通用进度计时器 Hook
 * 为所有图片生成面板提供：已用时间、总耗时、取消功能
 * 
 * 用法：
 * 1. 任务开始时调用 startTimer(taskId?)
 * 2. 任务完成/失败时调用 stopTimer()
 * 3. 取消时调用 cancelCurrentTask()
 * 4. 重置时调用 resetTimer()
 */
export function useProgressTimer() {
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState<number>(0);
  const [totalTime, setTotalTime] = useState<number | null>(null);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 启动计时器
  const startTimer = useCallback((taskId?: string) => {
    const now = Date.now();
    setStartTime(now);
    setElapsed(0);
    setTotalTime(null);
    if (taskId) setCurrentTaskId(taskId);
  }, []);

  // 停止计时器（任务完成/失败时调用）
  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (startTime) {
      setTotalTime(Date.now() - startTime);
    }
  }, [startTime]);

  // 重置计时器
  const resetTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setStartTime(null);
    setElapsed(0);
    setTotalTime(null);
    setCurrentTaskId(null);
  }, []);

  // 取消当前任务
  const cancelCurrentTask = useCallback(async () => {
    if (!currentTaskId) return false;
    try {
      const res = await fetch('/api/cancel-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: currentTaskId }),
      });
      const data = await res.json();
      if (data.success || data.cancelled) {
        stopTimer();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [currentTaskId, stopTimer]);

  // 计时器效果
  useEffect(() => {
    if (startTime && !totalTime) {
      timerRef.current = setInterval(() => {
        setElapsed(Date.now() - startTime);
      }, 1000);
      return () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      };
    }
  }, [startTime, totalTime]);

  // 格式化时间
  const formatTime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return minutes > 0 ? `${minutes}:${secs.toString().padStart(2, '0')}` : `${secs}s`;
  };

  return {
    startTime,
    elapsed,
    totalTime,
    currentTaskId,
    isRunning: startTime !== null && totalTime === null,
    startTimer,
    stopTimer,
    resetTimer,
    cancelCurrentTask,
    setCurrentTaskId,
    formatTime,
    /** 已用时间文本，如 "1:23" 或 "5s" */
    elapsedText: startTime ? formatTime(elapsed) : '',
    /** 总耗时文本，如 "总耗时 1:23"，仅在任务完成后有值 */
    totalTimeText: totalTime !== null ? `总耗时 ${formatTime(totalTime)}` : '',
  };
}
