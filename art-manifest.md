# 美術生成追蹤表（Art Manifest）

武俠/修仙世界觀 + 2.5D 等距視角的全部圖片需求。每個 prompt 完全獨立（可單獨複製使用，不依賴其他 prompt）。

生成規則（已內含在每條 prompt 裡）：
- **角色/怪物：近正面立繪視角**（Gemini 擅長且穩定的構圖；2.5D 空間感由地形 tile 承擔，這是戰棋遊戲常見做法，2026-07-13 定案）；**地形 tile：嚴格等距菱形**
- 洋紅 `#FF00FF` 純色不透明背景（禁止透明、漸層、棋盤格）——方便程式去背
- 四周留白，**右下角額外留大片空白**（浮水印通常在右下角，裁切時直接切掉），且右下角必須是同一個 #FF00FF，不能是另一塊不同色調的方形
- 圖內禁止任何文字/字樣/浮水印（文字由遊戲程式的多國語言系統顯示，圖文分離）
- 單一主體

狀態：⬜ 待生成 → ✅ 已收到並整合

| # | 圖片 ID | 用途 | 狀態 |
|---|---------|------|------|
| 1 | `yin_ghost` | 怪物：陰魂（近戰雜兵）——風格已定案（近正面立繪） | ✅ |
| 2 | `li_yan` | 角色：李焰（劍修，近戰） | ⬜ |
| 3 | `su_qing` | 角色：蘇晴（御劍/護體，遠程） | ⬜ |
| 4 | `jiangshi` | 怪物：殭屍（重擊+震退） | ⬜ |
| 5 | `yuan_ling` | 怪物：怨靈（遠程風箏型） | ⬜ |
| 6 | `teng_yao` | 怪物：藤妖（固定砲台） | ⬜ |
| 7 | `yao_lang` | 怪物：妖狼（快速近戰） | ⬜ |
| 8 | `tile_floor` | 地形：演武場石板地（等距菱形磁磚） | ⬜ |
| 9 | `tile_wall` | 地形：圍牆（等距牆块） | ⬜ |
| 10 | `tile_abyss` | 地形：深淵/斷崖（等距危險地格） | ⬜ |

---

## 1. `yin_ghost` — 陰魂

```
Game character asset, single creature centered in frame, near-frontal three-quarter view (standard 2D game character sprite view), full body, hovering idle pose.

Subject: a "Yin Ghost" — a small wraith-like spirit from Chinese xianxia folklore, made of translucent grey-green ghostly mist, faintly glowing pale-blue eyes, long trailing wisps instead of legs, thin clawed hands, hunched eerie posture. An original creature design for a Chinese cultivation-fantasy game, not based on any existing IP.

Style: Chinese ink-and-color painting aesthetic (traditional wuxia illustration) combined with clean flat cel-shading and bold outlines, suitable as a 2D game sprite. No photorealism.

Background: solid flat magenta color (#FF00FF), completely uniform — no gradient, no cast shadow on the background, no texture, no checkerboard pattern. Do NOT make the background transparent — it must be a solid opaque color for chroma-keying.

Composition: leave generous empty magenta margin on all four sides, and leave an extra-large empty magenta area in the bottom-right corner of the image (nothing may occupy the bottom-right corner, and it must be the exact same #FF00FF magenta as the rest of the background — not a different shade, not a separate rectangle).

Strictly no text, no lettering, no watermark, no logo, no signature anywhere in the image. Single subject only, no props, no other characters.
```

## 2. `li_yan` — 李焰（劍修）

```
Game character asset, single character centered in frame, near-frontal three-quarter view (standard 2D game character sprite view), full body, confident idle stance.

Subject: "Li Yan" — a young male sword cultivator from an original Chinese wuxia/xianxia fantasy world (not based on any existing novel or IP). Dark crimson and black flowing martial robes with gold trim, hair tied in a high topknot with a red ribbon, holding a single straight Chinese jian sword lowered at his side, calm fierce expression. Subtle ember-like qi glow around the blade.

Style: Chinese ink-and-color painting aesthetic (traditional wuxia illustration) combined with clean flat cel-shading and bold outlines, suitable as a 2D game sprite. No photorealism.

Background: solid flat magenta color (#FF00FF), completely uniform — no gradient, no cast shadow on the background, no texture, no checkerboard pattern. Do NOT make the background transparent — it must be a solid opaque color for chroma-keying.

Composition: leave generous empty magenta margin on all four sides, and leave an extra-large empty magenta area in the bottom-right corner of the image (nothing may occupy the bottom-right corner, and it must be the exact same #FF00FF magenta as the rest of the background — not a different shade, not a separate rectangle).

Strictly no text, no lettering, no watermark, no logo, no signature anywhere in the image. Single subject only, no props on the ground, no other characters.
```

## 3. `su_qing` — 蘇晴（御劍/護體）

```
Game character asset, single character centered in frame, near-frontal three-quarter view (standard 2D game character sprite view), full body, serene idle stance.

Subject: "Su Qing" — a young female cultivator from an original Chinese wuxia/xianxia fantasy world (not based on any existing novel or IP). Light azure and white flowing robes with silver cloud embroidery, long black hair partly pinned with a jade hairpin, one hand raised guiding a small glowing flying sword that hovers beside her shoulder, calm focused expression. Faint pale-blue qi aura.

Style: Chinese ink-and-color painting aesthetic (traditional wuxia illustration) combined with clean flat cel-shading and bold outlines, suitable as a 2D game sprite. No photorealism.

Background: solid flat magenta color (#FF00FF), completely uniform — no gradient, no cast shadow on the background, no texture, no checkerboard pattern. Do NOT make the background transparent — it must be a solid opaque color for chroma-keying.

Composition: leave generous empty magenta margin on all four sides, and leave an extra-large empty magenta area in the bottom-right corner of the image (nothing may occupy the bottom-right corner, and it must be the exact same #FF00FF magenta as the rest of the background — not a different shade, not a separate rectangle).

Strictly no text, no lettering, no watermark, no logo, no signature anywhere in the image. Single subject only, no other characters.
```

## 4. `jiangshi` — 殭屍

```
Game character asset, single creature centered in frame, near-frontal three-quarter view (standard 2D game character sprite view), full body, stiff menacing hopping stance with both arms outstretched forward.

Subject: a "Jiangshi" — a hopping stiff corpse from Chinese folklore, wearing tattered dark Qing-style burial robes, greyish-green rigid skin, a blank yellow paper talisman hanging over its forehead covering part of the face (the talisman is plain yellow with NO writing on it), long black fingernails. Heavy and imposing. An original creature design for a Chinese cultivation-fantasy game, not based on any existing IP.

Style: Chinese ink-and-color painting aesthetic (traditional wuxia illustration) combined with clean flat cel-shading and bold outlines, suitable as a 2D game sprite. No photorealism.

Background: solid flat magenta color (#FF00FF), completely uniform — no gradient, no cast shadow on the background, no texture, no checkerboard pattern. Do NOT make the background transparent — it must be a solid opaque color for chroma-keying.

Composition: leave generous empty magenta margin on all four sides, and leave an extra-large empty magenta area in the bottom-right corner of the image (nothing may occupy the bottom-right corner, and it must be the exact same #FF00FF magenta as the rest of the background — not a different shade, not a separate rectangle).

Strictly no text, no lettering, no watermark, no logo, no signature anywhere in the image (including on the paper talisman — keep it blank). Single subject only, no props, no other characters.
```

## 5. `yuan_ling` — 怨靈

```
Game character asset, single creature centered in frame, near-frontal three-quarter view (standard 2D game character sprite view), full body, drifting backward-leaning pose as if retreating while attacking.

Subject: a "Vengeful Spirit" (Yuan Ling) — a wailing female ghost from Chinese folklore, long unkempt black hair partially covering a pale sorrowful face, tattered flowing white burial dress dissolving into mist below the waist, hands forming a dark swirling orb of resentful qi in front of her chest. Ethereal and unsettling but stylized, not gory. An original creature design for a Chinese cultivation-fantasy game, not based on any existing IP.

Style: Chinese ink-and-color painting aesthetic (traditional wuxia illustration) combined with clean flat cel-shading and bold outlines, suitable as a 2D game sprite. No photorealism.

Background: solid flat magenta color (#FF00FF), completely uniform — no gradient, no cast shadow on the background, no texture, no checkerboard pattern. Do NOT make the background transparent — it must be a solid opaque color for chroma-keying.

Composition: leave generous empty magenta margin on all four sides, and leave an extra-large empty magenta area in the bottom-right corner of the image (nothing may occupy the bottom-right corner, and it must be the exact same #FF00FF magenta as the rest of the background — not a different shade, not a separate rectangle).

Strictly no text, no lettering, no watermark, no logo, no signature anywhere in the image. Single subject only, no props, no other characters.
```

## 6. `teng_yao` — 藤妖

```
Game character asset, single creature centered in frame, near-frontal three-quarter view (standard 2D game character sprite view), full body, rooted stationary pose.

Subject: a "Vine Demon" (Teng Yao) — a demonic plant creature from Chinese xianxia folklore: a gnarled mass of dark-green thorned vines twisted into a vaguely humanoid upper body rooted firmly into the ground, glowing amber eyes deep inside the tangle, several vine tendrils raised and poised to lash outward. It cannot walk — it is a living rooted trap. An original creature design for a Chinese cultivation-fantasy game, not based on any existing IP.

Style: Chinese ink-and-color painting aesthetic (traditional wuxia illustration) combined with clean flat cel-shading and bold outlines, suitable as a 2D game sprite. No photorealism.

Background: solid flat magenta color (#FF00FF), completely uniform — no gradient, no cast shadow on the background, no texture, no checkerboard pattern. Do NOT make the background transparent — it must be a solid opaque color for chroma-keying.

Composition: leave generous empty magenta margin on all four sides, and leave an extra-large empty magenta area in the bottom-right corner of the image (nothing may occupy the bottom-right corner, and it must be the exact same #FF00FF magenta as the rest of the background — not a different shade, not a separate rectangle).

Strictly no text, no lettering, no watermark, no logo, no signature anywhere in the image. Single subject only, no props, no other characters.
```

## 7. `yao_lang` — 妖狼

```
Game character asset, single creature centered in frame, near-frontal three-quarter view (standard 2D game character sprite view), full body, low prowling lunge-ready stance.

Subject: a "Demon Wolf" (Yao Lang) — a sleek supernatural wolf from Chinese xianxia folklore: jet-black fur with faint dark-purple qi flames trailing along its spine and paws, glowing crimson eyes, bared fangs, lean fast-looking body built for sudden lunges. An original creature design for a Chinese cultivation-fantasy game, not based on any existing IP.

Style: Chinese ink-and-color painting aesthetic (traditional wuxia illustration) combined with clean flat cel-shading and bold outlines, suitable as a 2D game sprite. No photorealism.

Background: solid flat magenta color (#FF00FF), completely uniform — no gradient, no cast shadow on the background, no texture, no checkerboard pattern. Do NOT make the background transparent — it must be a solid opaque color for chroma-keying.

Composition: leave generous empty magenta margin on all four sides, and leave an extra-large empty magenta area in the bottom-right corner of the image (nothing may occupy the bottom-right corner, and it must be the exact same #FF00FF magenta as the rest of the background — not a different shade, not a separate rectangle).

Strictly no text, no lettering, no watermark, no logo, no signature anywhere in the image. Single subject only, no props, no other characters.
```

## 8. `tile_floor` — 演武場石板地

```
Isometric game tile asset, a single flat diamond-shaped (rhombus) floor tile centered in frame, true isometric projection (2:1 width-to-height diamond), viewed from a 3/4 top-down isometric camera angle.

Subject: one seamless stone-slab floor tile for an ancient Chinese martial-arts sparring ground (Yanwu training courtyard): weathered grey stone slabs with subtle carved border lines, faint warm earthy tones, slight wear and small cracks for age. Flat tile only — no objects standing on it, no walls, no characters.

Style: Chinese ink-and-color painting aesthetic combined with clean flat cel-shading, suitable as a 2D game tile. No photorealism.

Background: solid flat magenta color (#FF00FF), completely uniform — no gradient, no cast shadow on the background, no texture, no checkerboard pattern. Do NOT make the background transparent — it must be a solid opaque color for chroma-keying.

Composition: the diamond tile centered with generous empty magenta margin on all four sides, and an extra-large empty magenta area in the bottom-right corner of the image (nothing may occupy the bottom-right corner).

Strictly no text, no lettering, no watermark, no logo, no signature anywhere in the image. Single tile only.
```

## 9. `tile_wall` — 圍牆

```
Isometric game tile asset, a single wall block centered in frame, true isometric projection (diamond footprint with vertical height, like an isometric cube), viewed from a 3/4 top-down isometric camera angle.

Subject: one section of an ancient Chinese courtyard wall for a martial-arts sparring ground: whitewashed plaster wall with a grey clay roof-tile cap on top (traditional Chinese wall coping), aged stains and cracks in the plaster, stone base. A single freestanding wall block that could tile seamlessly side by side. No gates, no doors, no objects, no characters.

Style: Chinese ink-and-color painting aesthetic combined with clean flat cel-shading, suitable as a 2D game tile. No photorealism.

Background: solid flat magenta color (#FF00FF), completely uniform — no gradient, no cast shadow on the background, no texture, no checkerboard pattern. Do NOT make the background transparent — it must be a solid opaque color for chroma-keying.

Composition: the wall block centered with generous empty magenta margin on all four sides, and an extra-large empty magenta area in the bottom-right corner of the image (nothing may occupy the bottom-right corner).

Strictly no text, no lettering, no watermark, no logo, no signature anywhere in the image. Single wall block only.
```

## 10. `tile_abyss` — 深淵/斷崖

```
Isometric game tile asset, a single flat diamond-shaped (rhombus) tile centered in frame, true isometric projection (2:1 width-to-height diamond), viewed from a 3/4 top-down isometric camera angle.

Subject: one bottomless abyss tile for an ancient Chinese martial-arts fantasy game: the diamond tile is a dark chasm opening in the ground — jagged broken stone edges around the rim, fading into pitch-black depth at the center, faint eerie teal mist rising from the darkness. Dangerous-looking. Flat tile only — no objects, no bridges, no characters.

Style: Chinese ink-and-color painting aesthetic combined with clean flat cel-shading, suitable as a 2D game tile. No photorealism.

Background: solid flat magenta color (#FF00FF), completely uniform — no gradient, no cast shadow on the background, no texture, no checkerboard pattern. Do NOT make the background transparent — it must be a solid opaque color for chroma-keying.

Composition: the diamond tile centered with generous empty magenta margin on all four sides, and an extra-large empty magenta area in the bottom-right corner of the image (nothing may occupy the bottom-right corner).

Strictly no text, no lettering, no watermark, no logo, no signature anywhere in the image. Single tile only.
```
