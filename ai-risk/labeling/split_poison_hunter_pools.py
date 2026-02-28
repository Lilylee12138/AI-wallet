import json, random
from pathlib import Path

SEED = 42
random.seed(SEED)

SRC = Path("data/poison_hunter_eth_addrs_all.json")
OUT_RISK = Path("data/poison_hunter_for_risklist.json")
OUT_TRAIN = Path("data/poison_hunter_for_training.json")

N_RISK = 5000
N_TRAIN = 3000

def main():
    obj = json.loads(SRC.read_text(encoding="utf-8"))
    addrs = obj["addresses"]
    random.shuffle(addrs)

    risk = addrs[:min(N_RISK, len(addrs))]
    remain = addrs[min(N_RISK, len(addrs)):]
    train = remain[:min(N_TRAIN, len(remain))]

    OUT_RISK.write_text(json.dumps({"seed": SEED, "addresses": risk}, indent=2), encoding="utf-8")
    OUT_TRAIN.write_text(json.dumps({"seed": SEED, "addresses": train}, indent=2), encoding="utf-8")

    print("Total extracted:", len(addrs))
    print("Risklist pool:", len(risk))
    print("Training pool:", len(train))
    print("Wrote:", OUT_RISK)
    print("Wrote:", OUT_TRAIN)

if __name__ == "__main__":
    main()
