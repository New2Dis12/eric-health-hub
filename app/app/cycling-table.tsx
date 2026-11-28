import { useLayoutEffect, useRef } from 'react'
import type { SessionSnapshot } from '@/lib/training/session'
import type { MetricTarget } from '@/lib/training/context-models'
import { durationClock } from '@/lib/training/duration'
import styles from './player.module.css'

export function CyclingTable({snapshot}:{snapshot:SessionSnapshot}) {
  const ref=useRef<HTMLDivElement>(null)
  useLayoutEffect(()=>{
    const box=ref.current
    if(!box) return
    const table=box.querySelector('table')!
    let active=true
    function fit(){
      if(!active || !box?.clientWidth) return
      table.style.fontSize='16px'
      for(let size=159; table.scrollWidth>box.clientWidth && size>=120; size--)
        table.style.fontSize=size/10+'px'
    }
    const observer=new ResizeObserver(fit)
    observer.observe(box)
    void document.fonts.ready.then(fit)
    fit()
    return ()=>{active=false;observer.disconnect()}
  },[snapshot])
  const rows=snapshot.exercises.flatMap(e=>{
    const work={phase:'work' as const,label:e.name,durationSeconds:e.durationSeconds,targets:e.targets??[]}
    return [...(e.warmups??[]),...(e.intervalBlocks?.length ? e.intervalBlocks.flatMap(b=>
      Array.from({length:b.repeat},()=>b.segments).flat()) : [work])]
  })
  const metrics=(['power','cycling_cadence','resistance'] as const).filter(m=>m==='power'||rows.some(r=>r.targets.some(t=>t.metric===m && t.range)))
  const units=new Set(rows.flatMap(r=>r.targets.filter(t=>t.metric==='resistance' && t.range).map(t=>t.unit)))
  const resUnit=units.size===1?[...units][0]:null
  const counts:Record<string,number>={}
  let clock:number|null=0
  const phaseNames={warmup:'WU',work:'W',recovery:'R',cooldown:'CD',transition:'T'}
  function target(targets:MetricTarget[],metric:string){
    const t=targets.find(t=>t.metric===metric && t.range)
    if(!t?.range) return ''
    return (t.range.min===t.range.max?String(t.range.min):t.range.min+'–'+t.range.max)+(metric==='resistance'&&!resUnit?' '+t.unit:'')
  }
  return <div ref={ref} className={styles.bikeGrid}><table aria-label="Prescribed cycling" data-columns={2 + metrics.length}><thead><tr>
    <th>Time</th><th>Seg.</th>{metrics.map(m=><th key={m}>{m==='power'?'Output':m==='resistance'?'Res.':'RPM'}{m==='power'||(m==='resistance'&&resUnit)?<small>({m==='power'?'W':resUnit})</small>:null}</th>)}
    </tr></thead><tbody>{rows.map((r,i)=>{
      const start:number|null=clock
      clock=start!==null && r.durationSeconds!==null?start+r.durationSeconds:null
      const time=clock!==null && start!==null?durationClock(start)+'–'+durationClock(clock):r.durationSeconds!==null?durationClock(r.durationSeconds):''
      counts[r.phase]=(counts[r.phase]??0)+1
      const phase=phaseNames[r.phase]+(['work','recovery'].includes(r.phase)?counts[r.phase]:'')
      return <tr key={i}><td>{time}</td><td aria-label={r.phase+' '+counts[r.phase]+': '+r.label}>{phase}</td>{metrics.map(m=><td key={m}>{target(r.targets,m)}</td>)}</tr>
    })}</tbody></table><small>WU warm-up · W work · R recovery · CD cooldown{counts.transition?' · T transition':''}</small></div>
}
