# ProofPay — Circom Circuits

## Circuit: `reputation_score.circom`

Proves `score >= threshold` without revealing tx_count, dispute_count, avg_balance, months_active.

### Score formula (integer arithmetic, no division)

```
score_proxy = min(tx_count, 50) * 480       # tx volume (max 24000)
            + (tx_count - disputes) * 480    # clean record (max 24000)
            + min(months_active, 12) * 1000  # wallet age (max 12000)
# total max = 60000 → 100 points
threshold_scaled = threshold * 600
proves: score_proxy >= threshold_scaled
```

### Tiers
| Tier   | Threshold | Benefits |
|--------|-----------|---------|
| Bronze | 40        | Basic payment access |
| Silver | 70        | Lower fees, higher limits |
| Gold   | 85        | Undercollateralised credit access |

### Setup

```bash
npm install -g circom snarkjs
./scripts/compile.sh
./scripts/setup.sh
```
