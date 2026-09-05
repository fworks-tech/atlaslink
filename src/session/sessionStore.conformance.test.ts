import { SessionBackendConformance } from './conformance.js'
import { SessionStore } from './sessionStore.js'

SessionBackendConformance('SessionStore', () => new SessionStore())
