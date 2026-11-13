import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkoutSourceResults } from '../../app/app/workout-source-results'
import type { SessionResults } from '../../lib/training/logging-models'
function Fixture() {
  const [data,setData]=useState<SessionResults|null>(null)
  async function refresh() {
    const response=await fetch('/results',{cache:'no-store'})
    if(!response.ok) return null
    const current=await response.json();setData(current);return current
  }
  useEffect(()=>{void refresh()},[])
  return data?<WorkoutSourceResults sessionId={data.sessionId} sessionRevision={data.sessionRevision} result={data.sourceResult} refresh={refresh}/>:<p>Loading synthetic workout</p>
}
createRoot(document.getElementById('root')!).render(<Fixture/> )
