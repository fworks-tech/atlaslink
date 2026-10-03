import { GraphQLResolveInfo } from 'graphql';
import { InsightsSubgraphDeps } from './resolvers';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
};

export type ContextPressure = {
  __typename?: 'ContextPressure';
  avgInputTokens: Scalars['Int']['output'];
  maxInputTokens: Scalars['Int']['output'];
  member: Scalars['String']['output'];
};

export type ContextUtil = {
  __typename?: 'ContextUtil';
  p50: Scalars['Float']['output'];
  p90: Scalars['Float']['output'];
  p99: Scalars['Float']['output'];
};

export type CostCenter = {
  __typename?: 'CostCenter';
  cost: Scalars['Float']['output'];
  member: Scalars['String']['output'];
  token: TokenBuckets;
};

export type CostTrend = {
  __typename?: 'CostTrend';
  changePct?: Maybe<Scalars['Float']['output']>;
  first: Scalars['Float']['output'];
  second: Scalars['Float']['output'];
};

export type InsightsReport = {
  __typename?: 'InsightsReport';
  byMember: Array<MemberUsage>;
  byModel: Array<ModelUsage>;
  contextUtil?: Maybe<ContextUtil>;
  costTrend?: Maybe<CostTrend>;
  count: Scalars['Int']['output'];
  errorCount: Scalars['Int']['output'];
  generatedAt: Scalars['String']['output'];
  highestOutputRatio: Array<OutputRatio>;
  topContext: Array<ContextPressure>;
  topCost: Array<CostCenter>;
  total: UsageGroup;
};

export type MemberUsage = {
  __typename?: 'MemberUsage';
  member: Scalars['String']['output'];
  usage: UsageGroup;
};

export type ModelUsage = {
  __typename?: 'ModelUsage';
  model: Scalars['String']['output'];
  usage: UsageGroup;
};

export type OutputRatio = {
  __typename?: 'OutputRatio';
  member: Scalars['String']['output'];
  ratio: Scalars['Float']['output'];
};

export type Query = {
  __typename?: 'Query';
  insights: InsightsReport;
};

export type TokenBuckets = {
  __typename?: 'TokenBuckets';
  input: Scalars['Int']['output'];
  output: Scalars['Int']['output'];
  total: Scalars['Int']['output'];
};

export type UsageGroup = {
  __typename?: 'UsageGroup';
  cost: Scalars['Float']['output'];
  durationMs: Scalars['Int']['output'];
  errors: Scalars['Int']['output'];
  runs: Scalars['Int']['output'];
  token: TokenBuckets;
};



export type ResolverTypeWrapper<T> = Promise<T> | T;


export type ResolverWithResolve<TResult, TParent, TContext, TArgs> = {
  resolve: ResolverFn<TResult, TParent, TContext, TArgs>;
};
export type Resolver<TResult, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = ResolverFn<TResult, TParent, TContext, TArgs> | ResolverWithResolve<TResult, TParent, TContext, TArgs>;

export type ResolverFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => Promise<TResult> | TResult;

export type SubscriptionSubscribeFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => AsyncIterable<TResult> | Promise<AsyncIterable<TResult>>;

export type SubscriptionResolveFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;

export interface SubscriptionSubscriberObject<TResult, TKey extends string, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<{ [key in TKey]: TResult }, TParent, TContext, TArgs>;
  resolve?: SubscriptionResolveFn<TResult, { [key in TKey]: TResult }, TContext, TArgs>;
}

export interface SubscriptionResolverObject<TResult, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<any, TParent, TContext, TArgs>;
  resolve: SubscriptionResolveFn<TResult, any, TContext, TArgs>;
}

export type SubscriptionObject<TResult, TKey extends string, TParent, TContext, TArgs> =
  | SubscriptionSubscriberObject<TResult, TKey, TParent, TContext, TArgs>
  | SubscriptionResolverObject<TResult, TParent, TContext, TArgs>;

export type SubscriptionResolver<TResult, TKey extends string, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> =
  | ((...args: any[]) => SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>)
  | SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>;

export type TypeResolveFn<TTypes, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (
  parent: TParent,
  context: TContext,
  info: GraphQLResolveInfo
) => Maybe<TTypes> | Promise<Maybe<TTypes>>;

export type IsTypeOfResolverFn<T = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (obj: T, context: TContext, info: GraphQLResolveInfo) => boolean | Promise<boolean>;

export type NextResolverFn<T> = () => Promise<T>;

export type DirectiveResolverFn<TResult = Record<PropertyKey, never>, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = (
  next: NextResolverFn<TResult>,
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;





/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = {
  ContextPressure: ResolverTypeWrapper<ContextPressure>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  ContextUtil: ResolverTypeWrapper<ContextUtil>;
  Float: ResolverTypeWrapper<Scalars['Float']['output']>;
  CostCenter: ResolverTypeWrapper<CostCenter>;
  CostTrend: ResolverTypeWrapper<CostTrend>;
  InsightsReport: ResolverTypeWrapper<InsightsReport>;
  MemberUsage: ResolverTypeWrapper<MemberUsage>;
  ModelUsage: ResolverTypeWrapper<ModelUsage>;
  OutputRatio: ResolverTypeWrapper<OutputRatio>;
  Query: ResolverTypeWrapper<Record<PropertyKey, never>>;
  TokenBuckets: ResolverTypeWrapper<TokenBuckets>;
  UsageGroup: ResolverTypeWrapper<UsageGroup>;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
};

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = {
  ContextPressure: ContextPressure;
  Int: Scalars['Int']['output'];
  String: Scalars['String']['output'];
  ContextUtil: ContextUtil;
  Float: Scalars['Float']['output'];
  CostCenter: CostCenter;
  CostTrend: CostTrend;
  InsightsReport: InsightsReport;
  MemberUsage: MemberUsage;
  ModelUsage: ModelUsage;
  OutputRatio: OutputRatio;
  Query: Record<PropertyKey, never>;
  TokenBuckets: TokenBuckets;
  UsageGroup: UsageGroup;
  Boolean: Scalars['Boolean']['output'];
};

export type ContextPressureResolvers<ContextType = InsightsSubgraphDeps, ParentType extends ResolversParentTypes['ContextPressure'] = ResolversParentTypes['ContextPressure']> = {
  avgInputTokens?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  maxInputTokens?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  member?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type ContextUtilResolvers<ContextType = InsightsSubgraphDeps, ParentType extends ResolversParentTypes['ContextUtil'] = ResolversParentTypes['ContextUtil']> = {
  p50?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  p90?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  p99?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
};

export type CostCenterResolvers<ContextType = InsightsSubgraphDeps, ParentType extends ResolversParentTypes['CostCenter'] = ResolversParentTypes['CostCenter']> = {
  cost?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  member?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  token?: Resolver<ResolversTypes['TokenBuckets'], ParentType, ContextType>;
};

export type CostTrendResolvers<ContextType = InsightsSubgraphDeps, ParentType extends ResolversParentTypes['CostTrend'] = ResolversParentTypes['CostTrend']> = {
  changePct?: Resolver<Maybe<ResolversTypes['Float']>, ParentType, ContextType>;
  first?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  second?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
};

export type InsightsReportResolvers<ContextType = InsightsSubgraphDeps, ParentType extends ResolversParentTypes['InsightsReport'] = ResolversParentTypes['InsightsReport']> = {
  byMember?: Resolver<Array<ResolversTypes['MemberUsage']>, ParentType, ContextType>;
  byModel?: Resolver<Array<ResolversTypes['ModelUsage']>, ParentType, ContextType>;
  contextUtil?: Resolver<Maybe<ResolversTypes['ContextUtil']>, ParentType, ContextType>;
  costTrend?: Resolver<Maybe<ResolversTypes['CostTrend']>, ParentType, ContextType>;
  count?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  errorCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  generatedAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  highestOutputRatio?: Resolver<Array<ResolversTypes['OutputRatio']>, ParentType, ContextType>;
  topContext?: Resolver<Array<ResolversTypes['ContextPressure']>, ParentType, ContextType>;
  topCost?: Resolver<Array<ResolversTypes['CostCenter']>, ParentType, ContextType>;
  total?: Resolver<ResolversTypes['UsageGroup'], ParentType, ContextType>;
};

export type MemberUsageResolvers<ContextType = InsightsSubgraphDeps, ParentType extends ResolversParentTypes['MemberUsage'] = ResolversParentTypes['MemberUsage']> = {
  member?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  usage?: Resolver<ResolversTypes['UsageGroup'], ParentType, ContextType>;
};

export type ModelUsageResolvers<ContextType = InsightsSubgraphDeps, ParentType extends ResolversParentTypes['ModelUsage'] = ResolversParentTypes['ModelUsage']> = {
  model?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  usage?: Resolver<ResolversTypes['UsageGroup'], ParentType, ContextType>;
};

export type OutputRatioResolvers<ContextType = InsightsSubgraphDeps, ParentType extends ResolversParentTypes['OutputRatio'] = ResolversParentTypes['OutputRatio']> = {
  member?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  ratio?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
};

export type QueryResolvers<ContextType = InsightsSubgraphDeps, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = {
  insights?: Resolver<ResolversTypes['InsightsReport'], ParentType, ContextType>;
};

export type TokenBucketsResolvers<ContextType = InsightsSubgraphDeps, ParentType extends ResolversParentTypes['TokenBuckets'] = ResolversParentTypes['TokenBuckets']> = {
  input?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  output?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  total?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type UsageGroupResolvers<ContextType = InsightsSubgraphDeps, ParentType extends ResolversParentTypes['UsageGroup'] = ResolversParentTypes['UsageGroup']> = {
  cost?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  durationMs?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  errors?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  runs?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  token?: Resolver<ResolversTypes['TokenBuckets'], ParentType, ContextType>;
};

export type Resolvers<ContextType = InsightsSubgraphDeps> = {
  ContextPressure?: ContextPressureResolvers<ContextType>;
  ContextUtil?: ContextUtilResolvers<ContextType>;
  CostCenter?: CostCenterResolvers<ContextType>;
  CostTrend?: CostTrendResolvers<ContextType>;
  InsightsReport?: InsightsReportResolvers<ContextType>;
  MemberUsage?: MemberUsageResolvers<ContextType>;
  ModelUsage?: ModelUsageResolvers<ContextType>;
  OutputRatio?: OutputRatioResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  TokenBuckets?: TokenBucketsResolvers<ContextType>;
  UsageGroup?: UsageGroupResolvers<ContextType>;
};

