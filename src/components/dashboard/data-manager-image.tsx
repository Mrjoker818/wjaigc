'use client';

import {useEffect,useRef,useState,type JSX} from 'react';
import {ImageOff,Loader2} from 'lucide-react';

interface DataManagerImageProps {
  src: string;
  alt: string;
  className: string;
  loading?: 'eager' | 'lazy';
  onRetry?: () => Promise<void>;
}

/** Local presentation only: never rewrites an original/signed URL or asset. */
export default function DataManagerImage({src,alt,className,loading='lazy',onRetry}:DataManagerImageProps):JSX.Element {
  const [failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0),[retrying,setRetrying]=useState(false);
  const currentAttempt=useRef(0),alive=useRef(true),pending=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);

  const retry=async():Promise<void>=>{
    if(pending.current||!alive.current)return;
    pending.current=true;setRetrying(true);
    try {
      // Refresh the existing readonly row information first. A changed URL
      // remounts this component through the caller's exact source key.
      await onRetry?.();
      if(!alive.current)return;
      currentAttempt.current++;setAttempt(currentAttempt.current);setFailed(false);
    }catch{
      if(alive.current)setFailed(true);
    }finally{
      pending.current=false;if(alive.current)setRetrying(false);
    }
  };
  const label=`原图暂不可用：${alt||'图片'}`;
  if(failed){
    if(!onRetry)return <span role="img" aria-label={label} className="flex h-full w-full items-center justify-center text-muted-foreground"><ImageOff size={24} aria-hidden="true" /></span>;
    return <div className="flex min-h-48 w-full flex-col items-center justify-center gap-3 p-4 text-center text-foreground" aria-busy={retrying}>
      <span role="img" aria-label={label}><ImageOff size={28} aria-hidden="true" /></span>
      <p className="text-sm">原图暂不可用</p>
      <button type="button" aria-label="重新加载原图" disabled={retrying} onClick={()=>void retry()} className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-border px-3 text-sm disabled:cursor-wait disabled:opacity-50">
        {retrying&&<Loader2 size={16} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
        {retrying?'正在重新加载':'重新加载原图'}
      </button>
    </div>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img key={attempt} src={src} alt={alt} className={className} loading={loading} onError={()=>{if(alive.current&&currentAttempt.current===attempt)setFailed(true);}} />;
}
