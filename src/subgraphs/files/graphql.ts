import { GraphQLResolveInfo } from 'graphql';
import { FilesContext } from './resolvers';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type RequireFields<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
};

export type Mutation = {
  __typename?: 'Mutation';
  commitFiles: Scalars['String']['output'];
};


export type MutationCommitFilesArgs = {
  message: Scalars['String']['input'];
  projectId: Scalars['ID']['input'];
  sessionId: Scalars['ID']['input'];
};

export type Query = {
  __typename?: 'Query';
  file?: Maybe<Scalars['String']['output']>;
  fileDiff: Scalars['String']['output'];
  files: Array<Scalars['String']['output']>;
};


export type QueryFileArgs = {
  commit?: InputMaybe<Scalars['String']['input']>;
  path: Scalars['String']['input'];
  projectId: Scalars['ID']['input'];
};


export type QueryFileDiffArgs = {
  from: Scalars['String']['input'];
  projectId: Scalars['ID']['input'];
  to: Scalars['String']['input'];
};


export type QueryFilesArgs = {
  commit?: InputMaybe<Scalars['String']['input']>;
  projectId: Scalars['ID']['input'];
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
  Mutation: ResolverTypeWrapper<Record<PropertyKey, never>>;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  Query: ResolverTypeWrapper<Record<PropertyKey, never>>;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
};

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = {
  Mutation: Record<PropertyKey, never>;
  String: Scalars['String']['output'];
  ID: Scalars['ID']['output'];
  Query: Record<PropertyKey, never>;
  Boolean: Scalars['Boolean']['output'];
};

export type MutationResolvers<ContextType = FilesContext, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = {
  commitFiles?: Resolver<ResolversTypes['String'], ParentType, ContextType, RequireFields<MutationCommitFilesArgs, 'message' | 'projectId' | 'sessionId'>>;
};

export type QueryResolvers<ContextType = FilesContext, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = {
  file?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType, RequireFields<QueryFileArgs, 'commit' | 'path' | 'projectId'>>;
  fileDiff?: Resolver<ResolversTypes['String'], ParentType, ContextType, RequireFields<QueryFileDiffArgs, 'from' | 'projectId' | 'to'>>;
  files?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType, RequireFields<QueryFilesArgs, 'commit' | 'projectId'>>;
};

export type Resolvers<ContextType = FilesContext> = {
  Mutation?: MutationResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
};

