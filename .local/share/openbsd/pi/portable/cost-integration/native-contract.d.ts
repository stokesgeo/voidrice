export interface CostReceipt {
 version: 1; origin: string; invocation: string; attempt: string; sequence: number; revision: number;
 lane: 'parent'|'child'|'summary'|'warming'|'label'|'nested'; provider: string; model: string;
 responseProvider?: string; responseModel?: string; responseId?: string; timestamp: string;
 usage: {input:number;output:number;cacheRead:number;cacheWrite:number;totalTokens?:number;reasoning?:number;cacheWrite1h?:number}|null;
 price: {status:'unknown'|'estimated'|'provider-reported'|'explicit-free';total:number|null;currency:'USD';provenance:string|null};
 final:boolean;outcome:'running'|'ok'|'error'|'cancelled'|'lost'|'not-started';aliases:string[];
}
export interface CostCarrier {
 costOrigin?: string;
 costReceiptIds?: string[];
 costAccounting?: { version:1; receipts:CostReceipt[] };
}
