# Disaster Recovery Plan

**Date:** 2026-09-05
**Status:** Active
**Owner:** Atlaslink Team

---

## Overview

This document outlines the disaster recovery (DR) procedures for Atlaslink, including backup strategies, recovery procedures, and runbooks for common failure scenarios.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Atlaslink Stack                        │
├─────────────────────────────────────────────────────────────┤
│  Dashboard (Vercel)     │  API Server (Render/Fly.io)      │
│  - Next.js app          │  - Fastify HTTP                   │
│  - Static assets        │  - WebSocket                     │
│  - BFF proxy            │  - SSE streams                   │
├─────────────────────────────────────────────────────────────┤
│                      Data Layer                             │
│  - PostgreSQL (primary) │  - NDJSON event log              │
│  - Session storage      │  - Auth store                    │
└─────────────────────────────────────────────────────────────┘
```

## Backup Strategy

### Database (PostgreSQL)

| Component | Strategy | Frequency | Retention |
|-----------|----------|-----------|-----------|
| Full backup | pg_dump | Daily at 02:00 UTC | 30 days |
| WAL archiving | Continuous | Real-time | 7 days |
| Logical replication | Optional | Real-time | Current |

**Backup command:**
```bash
pg_dump -Fc -Z 9 -f atlaslink_$(date +%Y%m%d_%H%M%S).dump atlaslink
```

**Restore command:**
```bash
pg_restore -d atlaslink atlaslink_YYYYMMDD_HHMMSS.dump
```

### Event Log (NDJSON)

| Component | Strategy | Frequency | Retention |
|-----------|----------|-----------|-----------|
| Event files | File copy | Hourly | 7 days |
| Compressed archives | gzip | Daily | 30 days |

**Backup command:**
```bash
tar -czf events_$(date +%Y%m%d_%H%M%S).tar.gz /data/events/
```

### Configuration

| Component | Strategy | Location |
|-----------|----------|----------|
| Environment variables | Git (private) | `.env.production` |
| Secrets | Vault/SSM | AWS SSM / Doppler |
| Database URLs | Vault/SSM | AWS SSM |

## Recovery Procedures

### Scenario 1: Database Corruption

**Symptoms:**
- Connection errors
- Data integrity issues
- Query failures

**Recovery steps:**
1. Stop the API server
2. Assess damage: `SELECT * FROM pg_stat_activity WHERE datname = 'atlaslink'`
3. Restore from latest backup:
   ```bash
   pg_restore -d atlaslink -c atlaslink_YYYYMMDD_HHMMSS.dump
   ```
4. Verify data integrity:
   ```bash
   psql -d atlaslink -c "SELECT COUNT(*) FROM sessions"
   psql -d atlaslink -c "SELECT COUNT(*) FROM session_events"
   ```
5. Restart API server
6. Verify health: `curl https://atlas.flabs.tech/health`

### Scenario 2: Event Log Loss

**Symptoms:**
- SSE streams fail
- Session history incomplete
- Dashboard shows missing events

**Recovery steps:**
1. Assess loss window from NDJSON files
2. Rebuild from database projection:
   ```bash
   # Sessions are the source of truth; events are derived
   # Rebuild event log from session state
   node scripts/rebuild-events.js
   ```
3. Verify SSE streams work
4. Notify users of potential gaps in session history

### Scenario 3: Complete Data Loss

**Symptoms:**
- Database unreachable
- All data gone
- Event log missing

**Recovery steps:**
1. **RTO (Recovery Time Objective):** 4 hours
2. **RPO (Recovery Point Objective):** 24 hours (daily backups)

**Procedure:**
1. Provision new database instance
2. Restore from latest backup:
   ```bash
   pg_restore -d atlaslink atlaslink_YYYYMMDD_HHMMSS.dump
   ```
3. Replay WAL archives if available:
   ```bash
   pg_walreplay /archive/wal/
   ```
4. Update connection strings in environment
5. Restart API server
6. Verify full functionality
7. Update DNS if needed

### Scenario 4: API Server Failure

**Symptoms:**
- 5xx errors
- Health check fails
- No response

**Recovery steps:**
1. Check server logs
2. Restart the service:
   ```bash
   # Render
   render services restart atlaslink-api
   
   # Fly.io
   fly restart --app atlaslink-api
   ```
3. If persistent, redeploy:
   ```bash
   git push origin main  # triggers auto-deploy
   ```
4. Verify health: `curl https://atlas.flabs.tech/health`

### Scenario 5: Dashboard Failure

**Symptoms:**
- Vercel deployment fails
- 404 errors
- Build errors

**Recovery steps:**
1. Check Vercel dashboard for build logs
2. Rollback to previous deployment:
   ```bash
   vercel rollback atlaslink-dashboard
   ```
3. If build issue, fix and push:
   ```bash
   git push origin main  # triggers auto-deploy
   ```
4. Verify dashboard loads

## Monitoring & Alerts

### Health Checks

| Endpoint | Frequency | Alert Threshold |
|----------|-----------|-----------------|
| `GET /health` | 1 minute | 3 consecutive failures |
| Database connection | 30 seconds | 5 consecutive failures |
| SSE stream health | 5 minutes | Stream down > 10 minutes |

### Alert Channels

| Severity | Channel | Response Time |
|----------|---------|---------------|
| Critical (P0) | PagerDuty | 15 minutes |
| High (P1) | Slack #incidents | 1 hour |
| Medium (P2) | Email | 24 hours |

### Key Metrics

| Metric | Threshold | Action |
|--------|-----------|--------|
| Error rate | > 1% | Investigate |
| Response time p99 | > 2s | Scale up |
| Database connections | > 80% | Scale up |
| Memory usage | > 80% | Restart/scale |

## Communication Plan

### Incident Timeline

1. **T+0:** Detect incident (monitoring alert)
2. **T+5:** Acknowledge in Slack #incidents
3. **T+15:** Initial assessment posted
4. **T+30:** Status page updated
5. **T+60:** Detailed update
6. **T+R:** Resolution confirmed
7. **T+24h:** Post-mortem scheduled

### Status Page

Update https://status.atlaslink.com with:
- Incident title
- Current status (investigating/identified/monitoring/resolved)
- Impact assessment
- Workaround (if available)

## Testing & Drills

### Quarterly DR Drills

| Quarter | Scenario | Success Criteria |
|---------|----------|------------------|
| Q1 | Database restore | RTO < 2 hours |
| Q2 | Complete failover | RTO < 4 hours |
| Q3 | Event log rebuild | RPO < 24 hours |
| Q4 | Full stack recovery | RTO < 4 hours, RPO < 24 hours |

### Drill Checklist

- [ ] Backup exists and is recent
- [ ] Restore procedure documented
- [ ] Team knows roles and responsibilities
- [ ] Communication plan tested
- [ ] Monitoring alerts work
- [ ] Post-drill review completed

## Contacts

| Role | Name | Contact |
|------|------|---------|
| Primary On-call | TBD | PagerDuty |
| Secondary On-call | TBD | PagerDuty |
| Database Admin | TBD | Slack |
| Infrastructure | TBD | Slack |

## References

- [PostgreSQL Backup & Restore](https://www.postgresql.org/docs/current/backup-dump.html)
- [WAL Archiving](https://www.postgresql.org/docs/current/runtime-config-wal.html)
- [Vercel Rollback](https://vercel.com/docs/deployments/rollback)
- [Render Recovery](https://render.com/docs/recovery)
