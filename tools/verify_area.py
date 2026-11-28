# 사용: python3 tools/verify_area.py  (js/formulas.js 함수 넓이 공식 덱의 공식 10가지와 원리를 무작위 함수 300개씩 정확한 분수 적분으로 확인, 40초쯤)
# 함수 넓이 공식 검증: 분수(정확한 유리수)로 다항식을 직접 적분해 공식과 비교하고,
# 실수 계산(심프슨 적분)으로 |f-g| 넓이도 따로 재서 한 번 더 맞춰 본다.
from fractions import Fraction as Fr
from math import factorial
import random

random.seed(20261126)

# ---- 다항식 (계수 리스트, 낮은 차수부터) ----
def padd(p, q):
    n = max(len(p), len(q)); return [(p[i] if i < len(p) else 0) + (q[i] if i < len(q) else 0) for i in range(n)]
def psub(p, q): return padd(p, [-c for c in q])
def pmul(p, q):
    r = [0] * (len(p) + len(q) - 1)
    for i, a in enumerate(p):
        for j, b in enumerate(q): r[i + j] += a * b
    return r
def pscale(p, k): return [c * k for c in p]
def ppow(p, n):
    r = [Fr(1)]
    for _ in range(n): r = pmul(r, p)
    return r
def pev(p, x):
    s = 0
    for c in reversed(p): s = s * x + c
    return s
def pder(p): return [i * p[i] for i in range(1, len(p))] or [0]
def pint(p, a, b):  # 정확한 정적분
    P = [0] + [Fr(c) / (i + 1) for i, c in enumerate(p)]
    return pev(P, b) - pev(P, a)
def lin(m, n): return [Fr(n), Fr(m)]  # y = m x + n
def tangent(p, t):  # x=t에서의 접선
    m = pev(pder(p), t); return lin(m, pev(p, t) - m * t)

def rnd(lo=-5, hi=5, den=4):
    while True:
        v = Fr(random.randint(lo * den, hi * den), den)
        if v != 0: return v
def rpair():
    while True:
        a, b = rnd(), rnd()
        if a != b: return (min(a, b), max(a, b))

def simpson_abs(f, a, b, n=4000):  # 실수로 ∫|f| (검산용)
    a, b = float(a), float(b); h = (b - a) / n
    s = abs(f(a)) + abs(f(b))
    for i in range(1, n):
        s += (4 if i % 2 else 2) * abs(f(a + i * h))
    return s * h / 3

checks = {}
def ok(name, cond):
    checks.setdefault(name, [0, 0]); checks[name][0] += 1
    if cond: checks[name][1] += 1
    else: print('FAIL', name)

N = 300
for _ in range(N):
    al, be = rpair()
    # 1. 이차함수와 직선: f = ax^2+bx+c, g = 직선, x=α,β에서 만남
    a = rnd(); g = lin(rnd(), rnd())
    f = padd(g, pscale(pmul(lin(1, -al), lin(1, -be)), a))  # f - g = a(x-α)(x-β)
    S = abs(pint(psub(f, g), al, be))
    ok('Q1 이차-직선 |a|(β-α)^3/6', S == abs(a) * (be - al) ** 3 / 6)
    ok('Q1 실수 검산', abs(simpson_abs(lambda x: pev(f, Fr(x)) - pev(g, Fr(x)) if False else float(pev(psub(f, g), Fr(x))), al, be) - float(S)) < 1e-6 * max(1, float(S)))

    # 2. 두 이차함수: f, h 의 x^2 계수 a, a' (a≠a'), x=α,β에서 만남
    a2 = rnd()
    while a2 == a: a2 = rnd()
    base = [rnd(), rnd(), rnd()]  # 아무 이차식
    f2 = padd(base, pscale(pmul(lin(1, -al), lin(1, -be)), a))
    h2 = padd(base, pscale(pmul(lin(1, -al), lin(1, -be)), a2))
    S = abs(pint(psub(f2, h2), al, be))
    ok("Q2 두 이차함수 |a-a'|(β-α)^3/6", S == abs(f2[2] - h2[2]) * (be - al) ** 3 / 6 and f2[2] - h2[2] == a - a2)

    # 3. 이차함수와 x=α, β에서의 두 접선
    q = [rnd(), rnd(), rnd()]  # c + b x + a x^2
    A = q[2]
    t1, t2 = tangent(q, al), tangent(q, be)
    # 두 접선의 교점
    xm = (t2[0] - t1[0]) / (t1[1] - t2[1])
    ok('Q3 두 접선의 교점 x=(α+β)/2', xm == (al + be) / 2)
    S = abs(pint(psub(q, t1), al, xm)) + abs(pint(psub(q, t2), xm, be))
    ok('Q3 이차-두 접선 |a|(β-α)^3/12', S == abs(A) * (be - al) ** 3 / 12)

    # 4. 이차함수, x=α의 접선, 직선 x=β
    S = abs(pint(psub(q, t1), al, be))
    ok('Q4 이차-접선-세로선 |a|(β-α)^3/3', S == abs(A) * (be - al) ** 3 / 3)

    # 5. 삼차함수와 x=α에서의 접선 (다시 x=β에서 만남) - 실제 삼차함수에서 β를 찾아서 확인
    cub = [rnd(), rnd(), rnd(), rnd()]  # d + c x + b x^2 + a x^3
    a3 = cub[3]
    T = tangent(cub, al)
    D = psub(cub, T)  # = a3 (x-α)^2 (x-β)
    # 근과 계수: α+α+β = -D[2]/D[3]
    bb = -D[2] / D[3] - 2 * al
    if bb != al:
        ok('Q5 접선이 다시 만나는 점 확인', pev(D, bb) == 0)
        lo, hi = min(al, bb), max(al, bb)
        S = abs(pint(D, lo, hi))
        ok('Q5 삼차-접선 |a|(β-α)^4/12', S == abs(a3) * (hi - lo) ** 4 / 12)
        ok('Q5 실수 검산', abs(simpson_abs(lambda x: float(pev(D, Fr(x))), lo, hi) - float(S)) < 1e-6 * max(1, float(S)))
        p = -cub[2] / (3 * cub[3])  # 변곡점
        ok('Q5 β = 3p - 2α (변곡점 p)', bb == 3 * p - 2 * al)
        # 6. 이어 그은 접선: x=β의 접선이 x=γ에서 만남 → 넓이 비 1:16
        T2 = tangent(cub, bb)
        D2 = psub(cub, T2)
        gg = -D2[2] / D2[3] - 2 * bb
        ok('Q6 γ 확인', pev(D2, gg) == 0)
        S2 = abs(pint(D2, min(bb, gg), max(bb, gg)))
        ok('Q6 넓이 비 S1:S2 = 1:16', S2 == 16 * S)
        ok('Q6 길이 비 |β-α|:|γ-β| = 1:2', abs(gg - bb) == 2 * abs(bb - al))

    # 7. 삼차함수와 변곡점을 지나는 직선 (세 점에서 만남) → 두 넓이가 같다
    p = -cub[2] / (3 * cub[3]); fp = pev(cub, p)
    # 직선 기울기 m: f(x) - L = a(x-p)((x-p)^2 - k^2) 꼴이 되도록, k^2 > 0인 기울기를 고른다
    k = rnd(1, 4)
    # f(x) - [fp + m(x-p)] 의 (x-p) 1차 계수 = f'(p) - m = -a k^2
    m = pev(pder(cub), p) + a3 * k * k
    L = lin(m, fp - m * p)
    D3 = psub(cub, L)
    ok('Q7 세 교점 p-k, p, p+k', pev(D3, p - k) == 0 and pev(D3, p) == 0 and pev(D3, p + k) == 0)
    s1 = abs(pint(D3, p - k, p)); s2 = abs(pint(D3, p, p + k))
    ok('Q7 두 넓이 같음 S1 = S2', s1 == s2 and s1 > 0)

    # 7-2. 삼차함수와 직선이 서로 다른 세 점 α < β < γ에서 만날 때 (f - L = a(x-α)(x-β)(x-γ))
    xs = sorted({al, be, rnd()})
    if len(xs) == 3:
        x1, x2, x3 = xs
        L = lin(rnd(), rnd())
        f3 = padd(L, pscale(pmul(pmul(lin(1, -x1), lin(1, -x2)), lin(1, -x3)), a3))
        D4 = psub(f3, L)
        s1 = abs(pint(D4, x1, x2)); s2 = abs(pint(D4, x2, x3))
        ok('Q7-2 세 실근 S1 = |a|(β-α)^3(2γ-α-β)/12', s1 == abs(a3) * (x2 - x1) ** 3 * (2 * x3 - x1 - x2) / 12)
        ok('Q7-2 세 실근 S2 = |a|(γ-β)^3(β+γ-2α)/12', s2 == abs(a3) * (x3 - x2) ** 3 * (x2 + x3 - 2 * x1) / 12)
        ok('Q7-2 요령: 2γ-α-β = (γ-α)+(γ-β), β+γ-2α = (β-α)+(γ-α)', 2 * x3 - x1 - x2 == (x3 - x1) + (x3 - x2) and x2 + x3 - 2 * x1 == (x2 - x1) + (x3 - x1))
        ok('Q7-2 실수 검산', abs(simpson_abs(lambda x: float(pev(D4, Fr(x))), x1, x2) - float(s1)) < 1e-6 * max(1, float(s1)))

    # 8. 사차함수와 두 점에서 접하는 직선
    a4 = rnd(); L = lin(rnd(), rnd())
    f4 = padd(L, pscale(pmul(ppow(lin(1, -al), 2), ppow(lin(1, -be), 2)), a4))
    ok('Q8 x=α, β에서 접함(기울기 같음)', pev(pder(f4), al) == L[1] and pev(pder(f4), be) == L[1])
    S = abs(pint(psub(f4, L), al, be))
    ok('Q8 사차-이중접선 |a|(β-α)^5/30', S == abs(a4) * (be - al) ** 5 / 30 and f4[4] == a4)
    ok('Q8 실수 검산', abs(simpson_abs(lambda x: float(pev(psub(f4, L), Fr(x))), al, be) - float(S)) < 1e-6 * max(1, float(S)))

    # 9. 사차함수와 x=α에서 세 겹(변곡점에서 접함), x=β에서 만나는 직선
    f5 = padd(L, pscale(pmul(ppow(lin(1, -al), 3), lin(1, -be)), a4))
    ok('Q9 x=α에서 접하고 f\'\'(α)=0 (변곡점)', pev(pder(f5), al) == L[1] and pev(pder(pder(f5)), al) == 0)
    S = abs(pint(psub(f5, L), al, be))
    ok('Q9 사차-변곡접선 |a|(β-α)^5/20', S == abs(a4) * (be - al) ** 5 / 20)
    # (α,β)에서 f-L 부호가 바뀌지 않는지 (넓이 = |적분|이 되려면)
    ok('Q9 사이에서 부호 일정', all(pev(psub(f5, L), al + (be - al) * Fr(i, 50)) * a4 <= 0 for i in range(1, 50)))

    # 10. 원리: ∫(x-α)^m (β-x)^n dx = m! n! / (m+n+1)! (β-α)^(m+n+1)
    for mm in range(0, 5):
        for nn in range(0, 5):
            v = pint(pmul(ppow(lin(1, -al), mm), ppow(lin(-1, be), nn)), al, be)
            ok('원리 베타 적분', v == Fr(factorial(mm) * factorial(nn), factorial(mm + nn + 1)) * (be - al) ** (mm + nn + 1))

# 표의 계수 확인
for (mm, nn, want) in [(1, 1, Fr(1, 6)), (2, 1, Fr(1, 12)), (2, 2, Fr(1, 30)), (3, 1, Fr(1, 20))]:
    ok('원리 표 m,n → 계수', Fr(factorial(mm) * factorial(nn), factorial(mm + nn + 1)) == want)

bad = 0
for k, (n, good) in checks.items():
    print(f'{"OK " if n == good else "BAD"} {good}/{n}  {k}')
    bad += n - good
print('모두 맞음' if not bad else f'틀림 {bad}개')
