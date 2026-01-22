#!/usr/bin/env python3
"""
상관계수 통계적 유의성 검증 도구
- t-검정을 통한 p-value 계산
- Fisher's Z-transformation으로 신뢰구간 산출
- Cohen's 기준 효과 크기 해석
"""

import numpy as np
from scipy import stats
import math

def verify_correlation_significance(r, n, alpha=0.05):
    """
    상관계수의 통계적 유의성 검증

    Args:
        r: 상관계수 (Pearson's r)
        n: 샘플 크기
        alpha: 유의수준 (기본 0.05)

    Returns:
        dict: 검증 결과 (p-value, 신뢰구간, 효과 크기 등)
    """

    # === 1. T-검정으로 p-value 계산 ===
    # H0: ρ = 0 (모집단 상관계수가 0이다)
    # H1: ρ ≠ 0 (모집단 상관계수가 0이 아니다)

    df = n - 2  # 자유도
    t_statistic = r * math.sqrt(df / (1 - r**2))
    p_value = 2 * (1 - stats.t.cdf(abs(t_statistic), df))  # 양측 검정

    # === 2. Fisher's Z-transformation으로 신뢰구간 계산 ===
    # r을 z로 변환 (정규분포에 가깝게 만듦)
    z = np.arctanh(r)  # 0.5 * ln((1+r)/(1-r))

    # 표준오차
    se_z = 1 / math.sqrt(n - 3)

    # z-score (95% 신뢰구간이면 1.96)
    z_critical = stats.norm.ppf(1 - alpha/2)

    # Z-변환 신뢰구간
    z_lower = z - z_critical * se_z
    z_upper = z + z_critical * se_z

    # 다시 r로 변환
    ci_lower = np.tanh(z_lower)
    ci_upper = np.tanh(z_upper)

    # === 3. 효과 크기 해석 (Cohen's 기준) ===
    abs_r = abs(r)
    if abs_r < 0.1:
        effect_size = "negligible (무시할 수 있는 수준)"
    elif abs_r < 0.3:
        effect_size = "small (작은 효과)"
    elif abs_r < 0.5:
        effect_size = "medium (중간 효과)"
    else:
        effect_size = "large (큰 효과)"

    # === 4. 결정계수 (R²) ===
    r_squared = r ** 2

    return {
        "r": r,
        "n": n,
        "df": df,
        "t_statistic": t_statistic,
        "p_value": p_value,
        "is_significant": p_value < alpha,
        "alpha": alpha,
        "ci_lower": ci_lower,
        "ci_upper": ci_upper,
        "confidence_level": int((1 - alpha) * 100),
        "effect_size": effect_size,
        "r_squared": r_squared,
        "variance_explained": f"{r_squared * 100:.1f}%"
    }

def format_result(result):
    """검증 결과를 읽기 쉬운 형식으로 출력"""

    print("=" * 70)
    print("📊 상관계수 통계적 유의성 검증 결과")
    print("=" * 70)

    print(f"\n【입력 정보】")
    print(f"  상관계수 (r):        {result['r']:.4f}")
    print(f"  샘플 크기 (n):       {result['n']}")
    print(f"  자유도 (df):         {result['df']}")

    print(f"\n【가설 검정】")
    print(f"  귀무가설 (H0):       ρ = 0 (상관관계 없음)")
    print(f"  대립가설 (H1):       ρ ≠ 0 (상관관계 있음)")
    print(f"  t-통계량:            {result['t_statistic']:.4f}")
    print(f"  p-value:             {result['p_value']:.6f}")
    print(f"  유의수준 (α):        {result['alpha']}")

    # 유의성 판정
    if result['is_significant']:
        print(f"  ✅ 결론:             통계적으로 유의함 (p < {result['alpha']})")
    else:
        print(f"  ❌ 결론:             통계적으로 유의하지 않음 (p ≥ {result['alpha']})")

    print(f"\n【신뢰구간】({result['confidence_level']}% CI)")
    print(f"  하한:                {result['ci_lower']:.4f}")
    print(f"  상한:                {result['ci_upper']:.4f}")
    print(f"  해석:                모집단 상관계수는 {result['confidence_level']}% 확률로")
    print(f"                       [{result['ci_lower']:.4f}, {result['ci_upper']:.4f}] 범위 내에 있음")

    print(f"\n【효과 크기 해석】")
    print(f"  결정계수 (R²):       {result['r_squared']:.4f}")
    print(f"  설명 가능한 분산:    {result['variance_explained']}")
    print(f"  Cohen's 기준:        {result['effect_size']}")

    print("\n" + "=" * 70)

def main():
    """제공된 사례 검증"""

    # 주어진 값
    r = 0.85
    n = 100

    # 검증 수행
    result = verify_correlation_significance(r, n, alpha=0.05)

    # 결과 출력
    format_result(result)

    # === 추가 해석 ===
    print("\n【추가 해석】")
    print(f"1. 통계적 유의성:")
    print(f"   p-value = {result['p_value']:.6f}은 0.05보다 훨씬 작으므로,")
    print(f"   귀무가설(상관관계 없음)을 기각합니다.")
    print(f"   즉, 두 변수 간에 통계적으로 유의한 상관관계가 존재합니다.")

    print(f"\n2. 신뢰구간 해석:")
    print(f"   모집단 상관계수는 95% 확률로 [{result['ci_lower']:.4f}, {result['ci_upper']:.4f}] 범위 내.")
    print(f"   신뢰구간이 0을 포함하지 않으므로 유의성 재확인.")

    print(f"\n3. 효과 크기:")
    print(f"   r = 0.85는 'large (큰 효과)' 수준으로,")
    print(f"   한 변수의 분산 중 {result['variance_explained']}를 다른 변수가 설명합니다.")
    print(f"   이는 실무적으로 매우 강한 상관관계입니다.")

    print(f"\n4. 샘플 크기 적절성:")
    print(f"   n = 100은 상관분석에 충분한 크기입니다.")
    print(f"   일반적으로 n ≥ 30이면 안정적인 추정이 가능합니다.")

if __name__ == "__main__":
    main()
