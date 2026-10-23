import {isDeepStrictEqual} from 'node:util';

export const isSearchTool=name=>name==='web_search'||name==='memory_search';

/** Gateway jsonResult carries the same JSON as text and details. Keep one copy
 * only when the complete envelope is proven redundant; otherwise preserve it. */
export function compactSearchResult(name,result) {
  if(!isSearchTool(name)||!result||typeof result!=='object')return result;
  if(Object.keys(result).sort().join(',')!=='content,details')return result;
  const {content,details}=result;
  if(!details||typeof details!=='object'||!Array.isArray(content)||content.length!==1)return result;
  const item=content[0];
  if(!item||Object.keys(item).sort().join(',')!=='text,type'||item.type!=='text'||typeof item.text!=='string')return result;
  try {return isDeepStrictEqual(JSON.parse(item.text),details)?details:result;}
  catch {return result;}
}

/** Fixed numeric diagnostics only; no query, result, path or provider message. */
export function searchMetrics(original,delivered,gatewayMs) {
  const bytes=value=>Buffer.byteLength(JSON.stringify(value)??'', 'utf8');
  const metrics={gatewayMs:Math.round(gatewayMs),originalBytes:bytes(original),deliveredBytes:bytes(delivered),compacted:original!==delivered};
  for(const key of ['managerMs','searchMs','toolMs','outsideSearchMs','hits','candidateHits','withheldHits']) {
    const value=original?.details?.debug?.[key];
    if(Number.isFinite(value)&&value>=0)metrics[key]=Math.round(value);
  }
  return metrics;
}
