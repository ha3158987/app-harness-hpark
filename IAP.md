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

## 2. "같은 웹, 두 가격" 분기 — **페이지 분리 불필요**

같은 페이지가 "앱인지 웹인지" 보고 **그 부분만 다르게 렌더**한다(반응형과 동일). 두 벌 유지 X.
**앱 가격은 코드에 박지 말고 스토어에서 읽는다**(실제 청구가=스토어 티어; 표시가≠청구가면 리젝/혼란).

### 방법 1 — 클라이언트 분기 (SPA/클라 렌더, 추천)
```js
import { AppBridge } from '@harness/bridge';
if (AppBridge.isNative) {
  const [p] = await AppBridge.getProducts();   // 앱: 스토어 현지화 가격(₩120 티어, 통화포맷까지)
  priceEl.textContent = p.price;               // "₩1,200"
  buyBtn.onclick = async () => { const r = await AppBridge.purchase('coin_100'); if (r.ok) refreshWallet(); };
} else {
  priceEl.textContent = krw(webPrice);         // 웹: 100원(백엔드/웹 설정) + 기존 PG
}
```

### 방법 2 — 서버 분기 (SSR 사이트)
서버에서 렌더하면 앱 WebView 의 **User-Agent 표식**으로 판별한다(하네스가 자동 주입):
```
User-Agent 에 "HarnessApp/<slug>/<version>" 포함  → 앱 요청
```
```js
// 서버(예시)
const isApp = /HarnessApp\//.test(req.headers['user-agent'] || '');
res.render('store', { price: isApp ? null /*스토어가 표시*/ : 100, showWebPay: !isApp });
```

### ⚠️ 가격보다 중요한 분기 = anti-steering
앱에선 **웹 결제 유도(배너/링크/웹 PG 버튼)를 숨겨야** 한다(리젝 사유):
```js
if (!AppBridge.isNative) showWebPromo();   // 웹에서만 노출
```

> **지갑은 서버 한 곳**(SSO 계정에 묶임). 앱 IAP든 웹 PG든 **같은 계정 잔액**에 적립. (인증/SSO 위에 얹힘)

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

## 4c. 지갑 정합성 — 웹/앱 같은 잔액
**잔액은 "기기"가 아니라 "계정(SSO)"에 묶인 서버 데이터.** 클라는 진실을 들지 않고 항상 서버에서 읽는다.
- 웹 PG 적립이든 앱 IAP 적립이든 백엔드의 **같은 `userId` 잔액**에 들어감(멱등: 거래ID 중복차단).
- 재조회 시점: **구매 직후 / 로그인 직후 / 앱 포그라운드 복귀**(다른 데서 충전했을 수 있음).
```js
import { fetchWallet, onResume } from './harness-adapter';
async function refresh() { walletEl.textContent = await fetchWallet(); }
await refresh();                 // 로그인/구매 후
onResume(refresh);              // 앱 복귀 시(웹은 focus/visibility) 자동 갱신
```
> 동시에 두 기기에서 보고 있으면: 폴링(onResume) 또는 서버 푸시(WebSocket/SSE)로 동기화. 보통 onResume + 구매후 갱신이면 충분.

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
