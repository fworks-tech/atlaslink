import { GraphQLResolveInfo, GraphQLScalarType, GraphQLScalarTypeConfig } from 'graphql';
import { TaskContext } from './resolvers';
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
  JSON: { input: unknown; output: unknown; }
};

export type Diagram = {
  __typename?: 'Diagram';
  edges: Array<DiagramEdge>;
  mode: DiagramMode;
  nodes: Array<DiagramNode>;
};

export type DiagramEdge = {
  __typename?: 'DiagramEdge';
  id: Scalars['ID']['output'];
  source: Scalars['ID']['output'];
  target: Scalars['ID']['output'];
};

export type DiagramEdgeInput = {
  id: Scalars['ID']['input'];
  source: Scalars['ID']['input'];
  target: Scalars['ID']['input'];
};

export type DiagramInput = {
  edges: Array<DiagramEdgeInput>;
  mode: DiagramMode;
  nodes: Array<DiagramNodeInput>;
};

export type DiagramMode =
  | 'chain'
  | 'fanout'
  | 'full';

export type DiagramNode = {
  __typename?: 'DiagramNode';
  id: Scalars['ID']['output'];
  position: DiagramPosition;
  type: Scalars['String']['output'];
};

export type DiagramNodeInput = {
  id: Scalars['ID']['input'];
  position: DiagramPositionInput;
  type: Scalars['String']['input'];
};

export type DiagramPosition = {
  __typename?: 'DiagramPosition';
  x: Scalars['Float']['output'];
  y: Scalars['Float']['output'];
};

export type DiagramPositionInput = {
  x: Scalars['Float']['input'];
  y: Scalars['Float']['input'];
};

export type DiagramSave = {
  __typename?: 'DiagramSave';
  diagram: Diagram;
  persisted: Scalars['Boolean']['output'];
};

export type Mutation = {
  __typename?: 'Mutation';
  createTask: Task;
  saveDiagram: DiagramSave;
};


export type MutationCreateTaskArgs = {
  member: Scalars['String']['input'];
  projectId: Scalars['ID']['input'];
  prompt: Scalars['String']['input'];
  tweaks?: InputMaybe<TaskTweaks>;
};


export type MutationSaveDiagramArgs = {
  diagram: DiagramInput;
  sessionId: Scalars['ID']['input'];
};

export type Query = {
  __typename?: 'Query';
  task?: Maybe<Task>;
  tasks: TaskPage;
};


export type QueryTaskArgs = {
  id: Scalars['ID']['input'];
};


export type QueryTasksArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  projectId?: InputMaybe<Scalars['ID']['input']>;
  since?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<TaskStatus>;
};

export type Session = {
  __typename?: 'Session';
  id: Scalars['ID']['output'];
};

export type Task = {
  __typename?: 'Task';
  createdAt?: Maybe<Scalars['String']['output']>;
  error?: Maybe<Scalars['String']['output']>;
  finishedAt?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  member: Scalars['String']['output'];
  projectId?: Maybe<Scalars['ID']['output']>;
  prompt: Scalars['String']['output'];
  replyCount: Scalars['Int']['output'];
  session?: Maybe<Session>;
  status: TaskStatus;
  tweaks?: Maybe<Scalars['JSON']['output']>;
};

export type TaskPage = {
  __typename?: 'TaskPage';
  limit: Scalars['Int']['output'];
  offset: Scalars['Int']['output'];
  tasks: Array<Task>;
  total: Scalars['Int']['output'];
};

export type TaskStatus =
  | 'awaiting_input'
  | 'cancelled'
  | 'failed'
  | 'queued'
  | 'running'
  | 'succeeded';

export type TaskTweaks = {
  member?: InputMaybe<Scalars['JSON']['input']>;
  provider?: InputMaybe<Scalars['String']['input']>;
  team?: InputMaybe<Scalars['JSON']['input']>;
};



export type ResolverTypeWrapper<T> = Promise<T> | T;

export type ReferenceResolver<TResult, TReference, TContext> = (
      reference: TReference,
      context: TContext,
      info: GraphQLResolveInfo
    ) => Promise<TResult> | TResult;

      type ScalarCheck<T, S> = S extends true ? T : NullableCheck<T, S>;
      type NullableCheck<T, S> = Maybe<T> extends T ? Maybe<ListCheck<NonNullable<T>, S>> : ListCheck<T, S>;
      type ListCheck<T, S> = T extends (infer U)[] ? NullableCheck<U, S>[] : GraphQLRecursivePick<T, S>;
      export type GraphQLRecursivePick<T, S> = { [K in keyof T & keyof S]: ScalarCheck<T[K], S[K]> };
    

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

/** Mapping of federation types */
export type FederationTypes = {
  Session: Session;
  Task: Task;
};

/** Mapping of federation reference types */
export type FederationReferenceTypes = {
  Session:
    ( { __typename: 'Session' }
    & GraphQLRecursivePick<FederationTypes['Session'], {"id":true}> );
  Task:
    ( { __typename: 'Task' }
    & GraphQLRecursivePick<FederationTypes['Task'], {"id":true}> );
};



/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = {
  Diagram: ResolverTypeWrapper<Diagram>;
  DiagramEdge: ResolverTypeWrapper<DiagramEdge>;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  DiagramEdgeInput: DiagramEdgeInput;
  DiagramInput: DiagramInput;
  DiagramMode: DiagramMode;
  DiagramNode: ResolverTypeWrapper<DiagramNode>;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  DiagramNodeInput: DiagramNodeInput;
  DiagramPosition: ResolverTypeWrapper<DiagramPosition>;
  Float: ResolverTypeWrapper<Scalars['Float']['output']>;
  DiagramPositionInput: DiagramPositionInput;
  DiagramSave: ResolverTypeWrapper<DiagramSave>;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  JSON: ResolverTypeWrapper<Scalars['JSON']['output']>;
  Mutation: ResolverTypeWrapper<Record<PropertyKey, never>>;
  Query: ResolverTypeWrapper<Record<PropertyKey, never>>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  Session: ResolverTypeWrapper<Session>;
  Task: ResolverTypeWrapper<Task>;
  TaskPage: ResolverTypeWrapper<TaskPage>;
  TaskStatus: TaskStatus;
  TaskTweaks: TaskTweaks;
};

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = {
  Diagram: Diagram;
  DiagramEdge: DiagramEdge;
  ID: Scalars['ID']['output'];
  DiagramEdgeInput: DiagramEdgeInput;
  DiagramInput: DiagramInput;
  DiagramNode: DiagramNode;
  String: Scalars['String']['output'];
  DiagramNodeInput: DiagramNodeInput;
  DiagramPosition: DiagramPosition;
  Float: Scalars['Float']['output'];
  DiagramPositionInput: DiagramPositionInput;
  DiagramSave: DiagramSave;
  Boolean: Scalars['Boolean']['output'];
  JSON: Scalars['JSON']['output'];
  Mutation: Record<PropertyKey, never>;
  Query: Record<PropertyKey, never>;
  Int: Scalars['Int']['output'];
  Session: Session | FederationReferenceTypes['Session'];
  Task: Task | FederationReferenceTypes['Task'];
  TaskPage: TaskPage;
  TaskTweaks: TaskTweaks;
};

export type DiagramResolvers<ContextType = TaskContext, ParentType extends ResolversParentTypes['Diagram'] = ResolversParentTypes['Diagram']> = {
  edges?: Resolver<Array<ResolversTypes['DiagramEdge']>, ParentType, ContextType>;
  mode?: Resolver<ResolversTypes['DiagramMode'], ParentType, ContextType>;
  nodes?: Resolver<Array<ResolversTypes['DiagramNode']>, ParentType, ContextType>;
};

export type DiagramEdgeResolvers<ContextType = TaskContext, ParentType extends ResolversParentTypes['DiagramEdge'] = ResolversParentTypes['DiagramEdge']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  source?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  target?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
};

export type DiagramNodeResolvers<ContextType = TaskContext, ParentType extends ResolversParentTypes['DiagramNode'] = ResolversParentTypes['DiagramNode']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  position?: Resolver<ResolversTypes['DiagramPosition'], ParentType, ContextType>;
  type?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type DiagramPositionResolvers<ContextType = TaskContext, ParentType extends ResolversParentTypes['DiagramPosition'] = ResolversParentTypes['DiagramPosition']> = {
  x?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  y?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
};

export type DiagramSaveResolvers<ContextType = TaskContext, ParentType extends ResolversParentTypes['DiagramSave'] = ResolversParentTypes['DiagramSave']> = {
  diagram?: Resolver<ResolversTypes['Diagram'], ParentType, ContextType>;
  persisted?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
};

export interface JsonScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['JSON'], any> {
  name: 'JSON';
}

export type MutationResolvers<ContextType = TaskContext, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = {
  createTask?: Resolver<ResolversTypes['Task'], ParentType, ContextType, RequireFields<MutationCreateTaskArgs, 'member' | 'projectId' | 'prompt'>>;
  saveDiagram?: Resolver<ResolversTypes['DiagramSave'], ParentType, ContextType, RequireFields<MutationSaveDiagramArgs, 'diagram' | 'sessionId'>>;
};

export type QueryResolvers<ContextType = TaskContext, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = {
  task?: Resolver<Maybe<ResolversTypes['Task']>, ParentType, ContextType, RequireFields<QueryTaskArgs, 'id'>>;
  tasks?: Resolver<ResolversTypes['TaskPage'], ParentType, ContextType, RequireFields<QueryTasksArgs, 'limit' | 'offset'>>;
};

export type SessionResolvers<ContextType = TaskContext, ParentType extends ResolversParentTypes['Session'] = ResolversParentTypes['Session'], FederationReferenceType extends FederationReferenceTypes['Session'] = FederationReferenceTypes['Session']> = {
  __resolveReference?: ReferenceResolver<Maybe<ResolversTypes['Session']> | FederationReferenceType, FederationReferenceType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
};

export type TaskResolvers<ContextType = TaskContext, ParentType extends ResolversParentTypes['Task'] = ResolversParentTypes['Task'], FederationReferenceType extends FederationReferenceTypes['Task'] = FederationReferenceTypes['Task']> = {
  __resolveReference?: ReferenceResolver<Maybe<ResolversTypes['Task']> | FederationReferenceType, FederationReferenceType, ContextType>;
  createdAt?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  error?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  finishedAt?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  member?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  projectId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  prompt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  replyCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  session?: Resolver<Maybe<ResolversTypes['Session']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['TaskStatus'], ParentType, ContextType>;
  tweaks?: Resolver<Maybe<ResolversTypes['JSON']>, ParentType, ContextType>;
};

export type TaskPageResolvers<ContextType = TaskContext, ParentType extends ResolversParentTypes['TaskPage'] = ResolversParentTypes['TaskPage']> = {
  limit?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  offset?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  tasks?: Resolver<Array<ResolversTypes['Task']>, ParentType, ContextType>;
  total?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type Resolvers<ContextType = TaskContext> = {
  Diagram?: DiagramResolvers<ContextType>;
  DiagramEdge?: DiagramEdgeResolvers<ContextType>;
  DiagramNode?: DiagramNodeResolvers<ContextType>;
  DiagramPosition?: DiagramPositionResolvers<ContextType>;
  DiagramSave?: DiagramSaveResolvers<ContextType>;
  JSON?: GraphQLScalarType;
  Mutation?: MutationResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  Session?: SessionResolvers<ContextType>;
  Task?: TaskResolvers<ContextType>;
  TaskPage?: TaskPageResolvers<ContextType>;
};

