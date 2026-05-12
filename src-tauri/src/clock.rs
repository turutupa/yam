use std::sync::LazyLock;
use std::time::Instant;

/// Process-wide monotonic epoch. All timestamps across threads
/// (engine, onset detector, timing analyzer) use this as their
/// zero-point so they are directly comparable.
static EPOCH: LazyLock<Instant> = LazyLock::new(Instant::now);

/// Returns nanoseconds elapsed since the process-wide epoch.
pub fn now_ns() -> u64 {
    EPOCH.elapsed().as_nanos() as u64
}
