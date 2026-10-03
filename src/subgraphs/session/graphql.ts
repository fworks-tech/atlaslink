import { GraphQLResolveInfo } from 'graphql';
import { SessionContext } from './resolvers';
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

export type AskHumanQuestion = {
  __typename?: 'AskHumanQuestion';
  context?: Maybe<Scalars['String']['output']>;
  question: Scalars['String']['output'];
};

export type Envelope = {
  __typename?: 'Envelope';
  at?: Maybe<Scalars['String']['output']>;
  correlationId?: Maybe<Scalars['String']['output']>;
  error?: Maybe<Scalars['String']['output']>;
  eventId: Scalars['Int']['output'];
  member?: Maybe<Scalars['String']['output']>;
  message?: Maybe<Scalars['String']['output']>;
  prompt?: Maybe<Scalars['String']['output']>;
  sessionId?: Maybe<Scalars['String']['output']>;
  type: Scalars['String']['output'];
};

export type InteractionTurn = {
  __typename?: 'InteractionTurn';
  at: Scalars['String']['output'];
  content: Scalars['String']['output'];
  member?: Maybe<Scalars['String']['output']>;
  role: Scalars['String']['output'];
};

export type Mutation = {
  __typename?: 'Mutation';
  appendMessage: Session;
  askFollowup: Session;
  cancelSession: Session;
  createSession: Session;
  replyToParked: Session;
  steerSession: Session;
};


export type MutationAppendMessageArgs = {
  content: Scalars['String']['input'];
  sessionId: Scalars['ID']['input'];
};


export type MutationAskFollowupArgs = {
  question: Scalars['String']['input'];
  sessionId: Scalars['ID']['input'];
};


export type MutationCancelSessionArgs = {
  id: Scalars['ID']['input'];
};


export type MutationCreateSessionArgs = {
  member: Scalars['String']['input'];
  projectId?: InputMaybe<Scalars['ID']['input']>;
  prompt: Scalars['String']['input'];
};


export type MutationReplyToParkedArgs = {
  reply: Scalars['String']['input'];
  sessionId: Scalars['ID']['input'];
};


export type MutationSteerSessionArgs = {
  content: Scalars['String']['input'];
  sessionId: Scalars['ID']['input'];
};

export type NextStep = {
  __typename?: 'NextStep';
  awaitingInput: Scalars['Boolean']['output'];
  member?: Maybe<Scalars['String']['output']>;
  prompt?: Maybe<Scalars['String']['output']>;
};

export type Query = {
  __typename?: 'Query';
  roomMembers: Array<RoomMember>;
  session?: Maybe<Session>;
  sessionEvents: Array<Envelope>;
  sessions: SessionPage;
};


export type QueryRoomMembersArgs = {
  sessionId: Scalars['ID']['input'];
};


export type QuerySessionArgs = {
  id: Scalars['ID']['input'];
};


export type QuerySessionEventsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  sessionId: Scalars['ID']['input'];
};


export type QuerySessionsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  projectId?: InputMaybe<Scalars['ID']['input']>;
  status?: InputMaybe<SessionStatus>;
};

export type RoomMember = {
  __typename?: 'RoomMember';
  id: Scalars['String']['output'];
  joinedAt: Scalars['String']['output'];
  name: Scalars['String']['output'];
};

export type Session = {
  __typename?: 'Session';
  correlationId: Scalars['String']['output'];
  createdAt?: Maybe<Scalars['String']['output']>;
  durationMs?: Maybe<Scalars['Int']['output']>;
  error?: Maybe<Scalars['String']['output']>;
  finishedAt?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  interaction: Array<InteractionTurn>;
  member: Scalars['String']['output'];
  nextStep?: Maybe<NextStep>;
  output?: Maybe<Scalars['String']['output']>;
  projectId?: Maybe<Scalars['ID']['output']>;
  prompt: Scalars['String']['output'];
  question?: Maybe<AskHumanQuestion>;
  replyCount: Scalars['Int']['output'];
  resumeOf?: Maybe<Scalars['ID']['output']>;
  startedAt?: Maybe<Scalars['String']['output']>;
  status: SessionStatus;
  tenantId?: Maybe<Scalars['String']['output']>;
  version: Scalars['Int']['output'];
};

export type SessionPage = {
  __typename?: 'SessionPage';
  sessions: Array<Session>;
  total: Scalars['Int']['output'];
};

export type SessionStatus =
  | 'awaiting_input'
  | 'cancelled'
  | 'failed'
  | 'queued'
  | 'running'
  | 'succeeded';



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
};

/** Mapping of federation reference types */
export type FederationReferenceTypes = {
  Session:
    ( { __typename: 'Session' }
    & GraphQLRecursivePick<FederationTypes['Session'], {"id":true}> );
};



/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = {
  AskHumanQuestion: ResolverTypeWrapper<AskHumanQuestion>;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  Envelope: ResolverTypeWrapper<Envelope>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  InteractionTurn: ResolverTypeWrapper<InteractionTurn>;
  Mutation: ResolverTypeWrapper<Record<PropertyKey, never>>;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  NextStep: ResolverTypeWrapper<NextStep>;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  Query: ResolverTypeWrapper<Record<PropertyKey, never>>;
  RoomMember: ResolverTypeWrapper<RoomMember>;
  Session: ResolverTypeWrapper<Session>;
  SessionPage: ResolverTypeWrapper<SessionPage>;
  SessionStatus: SessionStatus;
};

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = {
  AskHumanQuestion: AskHumanQuestion;
  String: Scalars['String']['output'];
  Envelope: Envelope;
  Int: Scalars['Int']['output'];
  InteractionTurn: InteractionTurn;
  Mutation: Record<PropertyKey, never>;
  ID: Scalars['ID']['output'];
  NextStep: NextStep;
  Boolean: Scalars['Boolean']['output'];
  Query: Record<PropertyKey, never>;
  RoomMember: RoomMember;
  Session: Session | FederationReferenceTypes['Session'];
  SessionPage: SessionPage;
};

export type AskHumanQuestionResolvers<ContextType = SessionContext, ParentType extends ResolversParentTypes['AskHumanQuestion'] = ResolversParentTypes['AskHumanQuestion']> = {
  context?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  question?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type EnvelopeResolvers<ContextType = SessionContext, ParentType extends ResolversParentTypes['Envelope'] = ResolversParentTypes['Envelope']> = {
  at?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  correlationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  error?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  eventId?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  member?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  message?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  prompt?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  sessionId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  type?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type InteractionTurnResolvers<ContextType = SessionContext, ParentType extends ResolversParentTypes['InteractionTurn'] = ResolversParentTypes['InteractionTurn']> = {
  at?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  content?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  member?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  role?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type MutationResolvers<ContextType = SessionContext, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = {
  appendMessage?: Resolver<ResolversTypes['Session'], ParentType, ContextType, RequireFields<MutationAppendMessageArgs, 'content' | 'sessionId'>>;
  askFollowup?: Resolver<ResolversTypes['Session'], ParentType, ContextType, RequireFields<MutationAskFollowupArgs, 'question' | 'sessionId'>>;
  cancelSession?: Resolver<ResolversTypes['Session'], ParentType, ContextType, RequireFields<MutationCancelSessionArgs, 'id'>>;
  createSession?: Resolver<ResolversTypes['Session'], ParentType, ContextType, RequireFields<MutationCreateSessionArgs, 'member' | 'prompt'>>;
  replyToParked?: Resolver<ResolversTypes['Session'], ParentType, ContextType, RequireFields<MutationReplyToParkedArgs, 'reply' | 'sessionId'>>;
  steerSession?: Resolver<ResolversTypes['Session'], ParentType, ContextType, RequireFields<MutationSteerSessionArgs, 'content' | 'sessionId'>>;
};

export type NextStepResolvers<ContextType = SessionContext, ParentType extends ResolversParentTypes['NextStep'] = ResolversParentTypes['NextStep']> = {
  awaitingInput?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  member?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  prompt?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
};

export type QueryResolvers<ContextType = SessionContext, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = {
  roomMembers?: Resolver<Array<ResolversTypes['RoomMember']>, ParentType, ContextType, RequireFields<QueryRoomMembersArgs, 'sessionId'>>;
  session?: Resolver<Maybe<ResolversTypes['Session']>, ParentType, ContextType, RequireFields<QuerySessionArgs, 'id'>>;
  sessionEvents?: Resolver<Array<ResolversTypes['Envelope']>, ParentType, ContextType, RequireFields<QuerySessionEventsArgs, 'limit' | 'sessionId'>>;
  sessions?: Resolver<ResolversTypes['SessionPage'], ParentType, ContextType, RequireFields<QuerySessionsArgs, 'limit' | 'offset'>>;
};

export type RoomMemberResolvers<ContextType = SessionContext, ParentType extends ResolversParentTypes['RoomMember'] = ResolversParentTypes['RoomMember']> = {
  id?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  joinedAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type SessionResolvers<ContextType = SessionContext, ParentType extends ResolversParentTypes['Session'] = ResolversParentTypes['Session'], FederationReferenceType extends FederationReferenceTypes['Session'] = FederationReferenceTypes['Session']> = {
  __resolveReference?: ReferenceResolver<Maybe<ResolversTypes['Session']> | FederationReferenceType, FederationReferenceType, ContextType>;
  correlationId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  createdAt?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  durationMs?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  error?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  finishedAt?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  interaction?: Resolver<Array<ResolversTypes['InteractionTurn']>, ParentType, ContextType>;
  member?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  nextStep?: Resolver<Maybe<ResolversTypes['NextStep']>, ParentType, ContextType>;
  output?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  projectId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  prompt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  question?: Resolver<Maybe<ResolversTypes['AskHumanQuestion']>, ParentType, ContextType>;
  replyCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  resumeOf?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  startedAt?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['SessionStatus'], ParentType, ContextType>;
  tenantId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  version?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type SessionPageResolvers<ContextType = SessionContext, ParentType extends ResolversParentTypes['SessionPage'] = ResolversParentTypes['SessionPage']> = {
  sessions?: Resolver<Array<ResolversTypes['Session']>, ParentType, ContextType>;
  total?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type Resolvers<ContextType = SessionContext> = {
  AskHumanQuestion?: AskHumanQuestionResolvers<ContextType>;
  Envelope?: EnvelopeResolvers<ContextType>;
  InteractionTurn?: InteractionTurnResolvers<ContextType>;
  Mutation?: MutationResolvers<ContextType>;
  NextStep?: NextStepResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  RoomMember?: RoomMemberResolvers<ContextType>;
  Session?: SessionResolvers<ContextType>;
  SessionPage?: SessionPageResolvers<ContextType>;
};

