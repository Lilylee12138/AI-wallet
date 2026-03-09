from xgb_engine import predict_prob

def score(feats):
    prob = float(predict_prob(feats))
    bps = int(prob * 10000)
    return prob, bps

def run_test(feature_name, values, base_feats):
    print(f"\n=== One-factor test: {feature_name} ===")
    print("base_feats =", base_feats)
    print("-" * 80)
    for v in values:
        feats = dict(base_feats)
        feats[feature_name] = v
        prob, bps = score(feats)
        print(f"{feature_name}={v:<10} -> prob={prob:.6f}, score_bps={bps}, feats={feats}")

if __name__ == "__main__":
    base = {
        "value_eth": 0.001,
        "is_new_recipient": 0.0,
        "interaction_count": 1.0,
        "gas_gwei": 1.5,
        "blacklist_hit": 0.0,
        "repeat_tx": 0.0,
    }

    # 1) value_eth 单因素测试
    run_test(
        "value_eth",
        [0.0001, 0.001, 0.01, 0.1, 1.0, 5.0],
        base
    )

    # 2) interaction_count 单因素测试
    run_test(
        "interaction_count",
        [1.0, 2.0, 3.0, 4.0, 5.0, 10.0],
        base
    )

    # 3) gas_gwei 单因素测试
    run_test(
        "gas_gwei",
        [1.0, 5.0, 20.0, 50.0, 100.0, 300.0],
        base
    )

    # 4) is_new_recipient 单因素测试
    run_test(
        "is_new_recipient",
        [0.0, 1.0],
        base
    )

    # 5) repeat_tx 单因素测试
    run_test(
        "repeat_tx",
        [0.0, 1.0],
        base
    )

    # 6) blacklist_hit 单因素测试
    run_test(
        "blacklist_hit",
        [0.0, 1.0],
        base
    )
