// Read-only UI lane contract. Use stats.aggregateUsage, NEVER parent context metrics.
export interface AggregateUsage {
  readonly version: 1;
  readonly label: 'Aggregate reported request usage';
  readonly tokens: Readonly<{input: number; output: number; cacheRead: number; cacheWrite: number}>;
  readonly disjointRequestTokens: number;
  readonly reportedTotalTokens: number; // provider total separately retained; not necessarily disjoint sum
  readonly reportedTotalMissing: number;
  readonly reasoningSubset: number; // already in output, do not add
  readonly cacheWrite1hSubset: number; // already in cacheWrite, do not add
  readonly knownCost: number; // known subtotal, NOT invoice, lower-bound or completeness assertion
  readonly currency: 'USD';
  readonly unknownPrice: number;
  readonly noUsage: number;
  readonly unfinished: number;
  readonly inheritedKnownCost: number;
  readonly newKnownCost: number;
  readonly priceKinds: Readonly<Record<string, number>>;
  readonly byLane: Readonly<Record<string, Readonly<{knownCost: number; unknownPrice: number; requests: number}>>>;
  readonly byModel: AggregateUsage['byLane']; // JSON encoded [responseProvider ?? provider,responseModel ?? model] keys
  readonly coverage: 'incomplete'; // this finite slice NEVER claims full capture
  readonly gaps: readonly string[];
  readonly receiptCount: number;
  readonly unresolvedLegacyCarriers: number; // excluded from numeric subtotal/tokens/split; NOT free
  readonly identityScope: string;
}
export interface InvalidAggregateUsage {
  readonly version: 1;
  readonly label: 'Aggregate reported request usage';
  readonly coverage: 'invalid';
  readonly knownCost: null;
  readonly tokens: null;
  readonly gaps: readonly ['invalid-accounting-data'];
}
// No totals from overview aliases, progress, child UsageStats or top-level child Usage
// may be added to this projection. Parent context/CH and existing stats.tokens unchanged.
