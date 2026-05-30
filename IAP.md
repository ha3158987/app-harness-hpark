# IAP — 인앱결제 (디지털 재화)

전략: **웹/앱 동시 서비스, 같은 상품을 웹 100원 / 앱 120원**(스토어 수수료 상쇄). 디지털 재화
(코인/회차)는 **스토어 IAP 강제** — 앱 안에서 자체 PG 로 못 판다. 웹은 기존 PG 그대로.

---

## 1. 정책 핵심 (지뢰)
- **디지털 재화 = 스토어 IAP 필수**(Apple IAP / Google Play Billing). 실물/외부서비스는 반대로 일반결제.
- **가격차(웹100/앱120)는 합법** — 단 앱 안에서 "웹 가면 싸요"라고 **유도(steering) 금지**.
- **수수료**: 30%(중소사업자/구독2년차 15%). 100원 net 하려면 앱 ≈143원, 120원은 부분상쇄(사업판단).
- 한국 대체결제는 혜택이 작아 보통 미사용(앱엔 스토어 IAP 만).
- **소비형(consumable, 코인) = 가장 단순.** 구독은 갱신/유예/취소 등 생명주기 + 서버알림 필수라 난도 ↑.

## 2. "같은 웹, 두 가격" 분기 (피처 디텍션)
```js
import { AppBridge } from '@harness/bridge';
if (AppBridge.isNative) {
  const products = await AppBridge.getProducts();      // 앱: 스토어 현지화 가격(120원 티어)
  const r = await AppBridge.purchase('coin_100');       // → 스토어 IAP → 백엔드 검증 → 서버지갑 적립
  if (r.ok) refreshWallet();
} else {
  // 웹: 100원 표시 + 기존 웹 PG 결제 → 같은 서버지갑에 적립
}
```
> **지갑은 서버 한 곳**(SSO 계정에 묶임). 앱 IAP든 웹 PG든 **같은 계정 잔액**에 적립. (인증/SSO 작업 위에 얹힘)

## 3. config (`apps/<slug>/app.config.json`)
```jsonc
"iap": {
  "verifyEndpoint": "https://aipia.co.kr/iap/verify",   // 영수증 검증 백엔드(보안상 필수)
  "products": [
    { "id": "coin_100", "storeId": "kr.co.aipia.app.coin100", "type": "consumable" },
    { "id": "coin_500", "storeId": "kr.co.aipia.app.coin500", "type": "consumable" }
  ]
}
```
- `id` = 웹/내부 SKU, `storeId` = 스토어 콘솔에 등록한 상품 ID. **가격은 config 가 아니라 스토어 콘솔**에서
  설정(앱 120원 티어). generate-app 이 상품 있으면 `cordova-plugin-purchase` 자동 설치.

## 4. 브릿지 API
| 메서드 | 설명 |
|---|---|
| `getProducts()` | 스토어 현지화 가격 포함 상품목록(앱). 웹은 `[]`(웹 가격은 웹이 표시) |
| `purchase(id)` | 구매 → 백엔드 영수증검증 → finish. `{ ok, productId, transactionId }` |
| `restorePurchases()` | 복원(재설치/기기변경). 소비형 코인은 서버지갑이 진실 |

웹(앱 아님)에서 `purchase()` 는 `reason:'web-should-use-pg'` 반환 → 웹은 자체 PG 사용.

## 5. 백엔드가 구현할 것 (직접 방식)
브릿지는 `cordova-plugin-purchase` 의 validator 로 **영수증을 `verifyEndpoint` 로 POST** 한다.
백엔드는:
1. **영수증 검증**
   - Apple: App Store Server API 로 거래(JWS) 검증(또는 verifyReceipt). in-app purchase 키 필요.
   - Google: Play Developer API `purchases.products.get` 로 검증 + **`acknowledge`(3일 내 필수, 안 하면 자동환불)**.
2. **서버 지갑 멱등 적립**: 거래ID로 중복/리플레이 차단 후 코인 적립.
3. **응답**: `cordova-plugin-purchase` 가 기대하는 검증결과 형식으로 반환(플러그인 validator 프로토콜).
4. **환불 회수(중요)**: App Store Server Notifications v2 / Google RTDN(Pub/Sub) 웹훅을 받아 환불/취소 시
   **코인 차감**. (consumable 도 환불은 발생)

> 구독을 추가하면: 갱신/유예/취소/업다운그레이드 상태를 서버알림으로 추적해야 함(난도 급증). 코인만이면 위 4개로 충분.

## 6. 스토어 콘솔 준비
- **App Store Connect**: In-App Purchase 상품 등록(Consumable), `storeId`=Product ID, 가격티어(120원대), 심사용 스크린샷.
- **Play Console**: 인앱 상품(관리형 상품) 등록, `storeId`=상품 ID, 가격. Play Billing 라이브러리(플러그인 포함).
- 샌드박스/라이선스 테스터로 결제 테스트(실결제 X).

## 7. 나중에 RevenueCat 로 교체?
웹/앱 코드(`AppBridge.purchase`)는 그대로 두고 브릿지 구현만 교체 가능(마케팅/인증 벤더 슬롯과 동일 패턴).
