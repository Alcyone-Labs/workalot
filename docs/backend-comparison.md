# Queue Backend Comparison Guide

## Overview

Workalot provides multiple queue backends to suit different deployment scenarios and performance requirements. Each backend has distinct characteristics that make it suitable for specific use cases.

## Backend Comparison Matrix

| Feature | Memory | SQLite | PGLite | PostgreSQL |
|---------|---------|---------|---------|------------|
| **Persistence** | ❌ Limited | ✅ Good | ✅ Good | ✅ Excellent |
| **Performance** | ⚡ Highest | ⚡ High | 🔄 Medium | 🔄 Variable |
| **Scalability** | ❌ Single Process | ✅ Single Machine | ✅ Single Machine | ✅ Multi-Machine |
| **Setup Complexity** | ✅ None | ✅ Minimal | 🔄 Moderate | ❌ High |
| **Memory Usage** | ❌ High | ✅ Low | 🔄 Medium | ✅ Low |
| **Concurrent Access** | ❌ Limited | ✅ Good (WAL) | ✅ Good | ✅ Excellent |
| **Query Capabilities** | ❌ Basic | ✅ Good | ✅ Full SQL | ✅ Full SQL |
| **Production Ready** | 🔄 Limited | ✅ Yes | 🔄 Experimental | ✅ Yes |

## Detailed Backend Analysis

### 1. Memory Queue

**Purpose**: High-performance, in-process job queue for development and testing scenarios.

#### Strengths
- **Blazing Fast Performance**: No I/O overhead, direct memory access
- **Zero Configuration**: Works immediately without any setup
- **Minimal Latency**: Microsecond-level job operations
- **Perfect for Testing**: Ideal for unit tests and development
- **Simple Implementation**: Easy to understand and debug

#### Weaknesses
- **No Persistence**: All jobs lost on process restart
- **Limited Scalability**: Cannot share jobs between processes
- **Memory Constraints**: Limited by available RAM
- **Single Point of Failure**: No redundancy or failover
- **No Advanced Features**: Basic FIFO operations only

#### Best Use Cases
- Local development and testing
- Temporary job processing
- High-frequency, short-lived tasks
- Prototyping and proof of concepts
- CI/CD pipeline jobs

#### Configuration Example
```typescript
import { TaskManager } from 'workalot';

const manager = new TaskManager({
  backend: 'memory',
  maxInMemoryAge: 60 * 60 * 1000, // 1 hour retention
});
```

#### Performance Characteristics
- **Throughput**: 100,000+ jobs/second
- **Latency**: < 1ms per operation
- **Memory Usage**: ~1KB per job

---

### 2. SQLite Queue

**Purpose**: Reliable, file-based queue with excellent performance and persistence for single-machine deployments.

#### Strengths
- **Excellent Performance**: Near-memory speeds with WAL mode
- **Built-in Persistence**: Automatic disk persistence
- **Zero Dependencies**: Native support in most environments
- **ACID Compliance**: Full transactional guarantees
- **Concurrent Access**: WAL mode enables multiple readers
- **Rich Query Support**: Full SQL capabilities
- **Portable**: Single file database, easy backup/restore
- **Battle-tested**: Mature, stable technology

#### Weaknesses
- **Single Machine Only**: Cannot scale across servers
- **Write Contention**: Single writer limitation
- **File Locking Issues**: NFS/network filesystem problems
- **Limited Concurrent Writes**: Serialized write operations
- **Size Limitations**: Performance degrades with very large databases
- **No Built-in Replication**: Manual backup strategies needed

#### Best Use Cases
- Small to medium applications
- Desktop applications
- Edge computing scenarios
- Embedded systems
- Single-server deployments
- Applications requiring portability

#### Configuration Example
```typescript
import { TaskManager } from 'workalot';

const manager = new TaskManager({
  backend: 'sqlite',
  databaseUrl: './data/queue.db', // or 'memory://' for in-memory
  // SQLite-specific optimizations
  sqliteConfig: {
    walMode: true,           // Enable WAL for better concurrency
    busyTimeout: 5000,       // Wait up to 5s for locks
    cacheSize: 10000,        // Page cache size
    synchronous: 'NORMAL',   // Balance between safety and speed
  }
});
```

#### Performance Characteristics
- **Throughput**: 10,000-50,000 jobs/second (WAL mode)
- **Latency**: 1-5ms per operation
- **Database Size**: Performs well up to 10GB
- **Concurrent Readers**: Unlimited with WAL
- **Concurrent Writers**: 1 (serialized)

#### Optimization Tips
- Enable WAL mode for better concurrency
- Use in-memory database for temporary queues
- Regular VACUUM for long-running applications
- Proper indexing on job status and priority
- Batch operations when possible

---

### 3. PGLite Queue

**Purpose**: PostgreSQL-compatible queue running in WebAssembly for advanced SQL features without server setup.

#### Strengths
- **PostgreSQL Compatibility**: Full PostgreSQL SQL syntax
- **No Server Required**: Runs entirely in-process
- **Advanced Features**: CTEs, window functions, JSON operations
- **Rich Data Types**: Arrays, JSON, custom types
- **Complex Queries**: Full SQL power for analytics
- **ACID Compliance**: Full transactional support
- **Extension Support**: Many PostgreSQL extensions available

#### Weaknesses
- **WebAssembly Overhead**: Slower than native implementations
- **Memory Usage**: Higher memory footprint
- **Startup Time**: Slow initialization (1-2 seconds)
- **Experimental Status**: Less battle-tested
- **Limited Ecosystem**: Fewer tools and utilities
- **No Network Access**: Cannot connect remotely
- **Platform Limitations**: WebAssembly constraints

#### Best Use Cases
- Development environments needing PostgreSQL compatibility
- Applications requiring advanced SQL features
- Offline-first applications
- Testing PostgreSQL-specific code
- Serverless environments with PostgreSQL needs
- Educational purposes

#### Configuration Example
```typescript
import { TaskManager } from 'workalot';

const manager = new TaskManager({
  backend: 'pglite',
  databaseUrl: './data/pglite', // Directory for data files
  pgliteConfig: {
    memory: true,           // Run entirely in memory
    relaxedDurability: true, // Trade durability for speed
    extensions: {
      pgvector: true,       // Enable vector operations
      postgis: false,       // Spatial data support
    }
  }
});
```

#### Performance Characteristics
- **Throughput**: 1,000-5,000 jobs/second
- **Latency**: 5-20ms per operation
- **Memory Usage**: 50-200MB baseline
- **Startup Time**: 1-2 seconds
- **Query Complexity**: Handles complex queries well

#### Optimization Tips
- Use in-memory mode for better performance
- Enable relaxed durability for non-critical data
- Minimize extension usage
- Batch operations heavily
- Consider SQLite for production

---

### 4. PostgreSQL Queue

**Purpose**: Enterprise-grade queue backend for distributed, high-reliability production deployments.

#### Strengths
- **Enterprise Features**: Replication, partitioning, clustering
- **Horizontal Scalability**: Multi-server deployments
- **Advanced Querying**: Full SQL with extensions
- **LISTEN/NOTIFY**: Real-time event notifications
- **Connection Pooling**: Efficient resource usage
- **Monitoring Tools**: Rich ecosystem of tools
- **High Availability**: Master-slave replication
- **Point-in-Time Recovery**: Advanced backup strategies
- **Row-Level Locking**: Fine-grained concurrency control
- **Proven Reliability**: Decades of production use

#### Weaknesses
- **Setup Complexity**: Requires database server
- **Network Overhead**: Remote connection latency
- **Resource Intensive**: Requires dedicated resources
- **Configuration Complexity**: Many tuning parameters
- **Maintenance Overhead**: Regular maintenance needed
- **Cost**: Infrastructure and operational costs
- **Overkill for Simple Use**: Too complex for basic needs

#### Best Use Cases
- Large-scale production systems
- Distributed applications
- Multi-tenant systems
- High-availability requirements
- Complex reporting needs
- Microservices architectures
- Financial/healthcare applications

#### Configuration Example
```typescript
import { TaskManager } from 'workalot';

const manager = new TaskManager({
  backend: 'postgresql',
  databaseUrl: 'postgresql://user:pass@localhost:5432/queue_db',
  postgresConfig: {
    // Connection pool settings
    poolSize: 20,
    idleTimeout: 10000,
    connectionTimeout: 5000,

    // Performance tuning
    statementTimeout: 30000,
    queryTimeout: 60000,

    // Features
    enableListen: true,      // LISTEN/NOTIFY support
    enablePartitioning: true, // Table partitioning

    // SSL configuration
    ssl: {
      rejectUnauthorized: true,
      ca: fs.readFileSync('./ca.pem'),
    }
  }
});
```

#### Performance Characteristics
- **Throughput**: 5,000-50,000 jobs/second (depends on hardware)
- **Latency**: 2-10ms per operation (local network)
- **Scalability**: Linear with hardware
- **Concurrent Connections**: 100-1000+
- **Database Size**: Terabytes without issue

#### Optimization Tips
- Use connection pooling (pgbouncer/pgpool)
- Proper indexing strategy
- Regular VACUUM and ANALYZE
- Table partitioning for large datasets
- Read replicas for query scaling
- LISTEN/NOTIFY for real-time updates
- Prepared statements for better performance

---

## Decision Matrix

### Choose Memory Queue When:
- ✅ Developing and testing
- ✅ Performance is critical
- ✅ Job persistence isn't required
- ✅ Running in a single process
- ✅ Jobs are short-lived

### Choose SQLite Queue When:
- ✅ Need persistence without a server
- ✅ Deploying to edge/embedded devices
- ✅ Single machine deployment
- ✅ Want simple backup/restore
- ✅ Need good performance with persistence

### Choose PGLite Queue When:
- ✅ Need PostgreSQL compatibility
- ✅ Want advanced SQL features
- ✅ Testing PostgreSQL-specific code
- ✅ Running in serverless environments
- ✅ Learning/educational purposes

### Choose PostgreSQL Queue When:
- ✅ Building production systems
- ✅ Need horizontal scalability
- ✅ Require high availability
- ✅ Complex querying requirements
- ✅ Multi-tenant applications
- ✅ Distributed architectures

## Migration Strategies

### Memory → SQLite
```typescript
// Minimal changes required
const devConfig = { backend: 'memory' };
const prodConfig = { backend: 'sqlite', databaseUrl: './queue.db' };
```

### SQLite → PostgreSQL
```typescript
// Export from SQLite
const sqliteData = await sqliteQueue.getAllJobs();

// Import to PostgreSQL
for (const job of sqliteData) {
  await postgresQueue.addJob(job);
}
```

### PostgreSQL → PGLite (for testing)
```typescript
// Use same SQL queries, just different connection
const prodConfig = { backend: 'postgresql', databaseUrl: 'postgres://...' };
const testConfig = { backend: 'pglite', databaseUrl: 'memory://' };
```

## Performance Tuning Guidelines

### Memory Queue
- Implement job expiration
- Monitor memory usage
- Use job batching
- Implement cleanup intervals

### SQLite Queue
- Enable WAL mode
- Optimize page cache
- Regular VACUUM
- Proper indexing

### PGLite Queue
- Use in-memory mode when possible
- Batch operations
- Minimize extension usage
- Consider native alternatives for production

### PostgreSQL Queue
- Connection pooling
- Query optimization
- Partitioning strategy
- Read replica configuration
- Monitoring and alerting

## Conclusion

The choice of queue backend depends on your specific requirements:

- **Development**: Start with Memory or SQLite
- **Production**: Consider SQLite for simple cases, PostgreSQL for complex
- **Testing**: PGLite for PostgreSQL compatibility testing
- **Scale**: PostgreSQL for distributed systems

Remember that you can start simple and migrate as your needs grow. The consistent API across all backends makes migration straightforward.
