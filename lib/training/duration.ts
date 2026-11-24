// Round before splitting the clock so a carry can cross an hour boundary.
const hundredths = new Intl.NumberFormat('en-US', {
  useGrouping:false, minimumFractionDigits:2, maximumFractionDigits:2,
})
export function durationClock(seconds:number, measured=false) {
  const [whole,fraction] = hundredths.format(measured ? seconds : Math.round(seconds)).split('.')
  const total=Number(whole), hours=Math.floor(total/3600)
  const pad=(n:number)=>String(n).padStart(2,'0')
  return (hours ? pad(hours)+':' : '')+pad(Math.floor(total/60)%60)+':'+pad(total%60)+
    (measured && fraction !== '00' ? '.'+fraction : '')
}
export function durationWords(seconds:number):string {
  if (seconds < 60) return seconds+' second'+(seconds===1?'':'s')
  if (seconds%15===0) return seconds/60+' minute'+(seconds===60?'':'s')
  const minutes=Math.floor(seconds/60)
  return minutes+' minute'+(minutes===1?'':'s')+' '+durationWords(seconds%60)
}

// Limit substitutions to prescribed instruction text. Pace units and user logs
// have different semantics and must keep their original wording.
export function instructionDurations(text:string) {
  return text.replace(/\b(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b(?!\s*\/)/gi,
    (_,value:string)=>durationWords(Number(value)))
}
