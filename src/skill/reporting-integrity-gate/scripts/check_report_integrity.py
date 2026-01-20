#!/usr/bin/env python3
import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import datetime

PATTERNS = {
    "bundle_context": re.compile(r"\[BUNDLE_CONTEXT\]"),
    "cycle_integrity_verified": re.compile(r"cycle_integrity_verified"),
    "preflight_validation_pass": re.compile(r"\[PREFLIGHT_VALIDATION_PASS\]"),
    "bundle_send_success": re.compile(r"\[BUNDLE_SEND_SUCCESS\]"),
    "bundle_landed": re.compile(r"\[BUNDLE_LANDED\]"),
    "bundle_landed_rpc_fallback": re.compile(r"\[BUNDLE_LANDED_RPC_FALLBACK\]"),
    "bundle_grpc_timeout": re.compile(r"\[BUNDLE_GRPC_TIMEOUT\]"),
    "bundle_not_landed": re.compile(r"\[BUNDLE_NOT_LANDED\]"),
    "dlmm_bin_array_cached_fail": re.compile(r"dlmm_bin_array_cached_fail"),
    "inactive_pool_skip": re.compile(r"inactive_pool_skip"),
    "build_failed": re.compile(r"build_failed"),
}

HEARTBEAT_RE = re.compile(r"\[HEARTBEAT_METRIC\].*?valid_opps=(\d+)")
DYNAMIC_POOLS_RE = re.compile(r"Dynamic pools: (\d+)")
ALLOWED_TRADE_MINTS_RE = re.compile(r"\[ALLOWED_TRADE_MINTS\].*?Using (\d+) mints")
ALERT_SUMMARY_RE = re.compile(r"\[ALERT_SUMMARY\].*")


def parse_log(path: str) -> dict:
    counts = defaultdict(int)
    last_heartbeat = None
    last_dynamic_pools = None
    last_allowed_trade_mints = None
    last_alert_summary = None

    with open(path, "r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            for key, pattern in PATTERNS.items():
                if pattern.search(line):
                    counts[key] += 1

            hb_match = HEARTBEAT_RE.search(line)
            if hb_match:
                last_heartbeat = {
                    "line": line.strip(),
                    "valid_opps": int(hb_match.group(1)),
                }

            dyn_match = DYNAMIC_POOLS_RE.search(line)
            if dyn_match:
                last_dynamic_pools = {
                    "line": line.strip(),
                    "count": int(dyn_match.group(1)),
                }

            allowed_match = ALLOWED_TRADE_MINTS_RE.search(line)
            if allowed_match:
                last_allowed_trade_mints = {
                    "line": line.strip(),
                    "count": int(allowed_match.group(1)),
                }

            alert_match = ALERT_SUMMARY_RE.search(line)
            if alert_match:
                last_alert_summary = alert_match.group(0)

    return {
        "log_path": path,
        "timestamp_utc": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "counts": dict(counts),
        "last_heartbeat": last_heartbeat,
        "last_dynamic_pools": last_dynamic_pools,
        "last_allowed_trade_mints": last_allowed_trade_mints,
        "last_alert_summary": last_alert_summary,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check reporting integrity by extracting key metrics from a log file."
    )
    parser.add_argument("--log", required=True, help="Path to the log file to analyze")
    parser.add_argument("--json", help="Optional path to write JSON output")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON to stdout")
    args = parser.parse_args()

    result = parse_log(args.log)
    output = json.dumps(result, indent=2 if args.pretty else None, sort_keys=True)

    if args.json:
        with open(args.json, "w", encoding="utf-8") as handle:
            handle.write(output)

    print(output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
