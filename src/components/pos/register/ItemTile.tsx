'use client'

// One menu tile. Memoised on purpose: the register shows ~140 of them and the screen
// re-renders on every tap (the ticket changes), so a tile re-renders only when ITS count,
// language or entry changes. The handlers it receives are stable (RegisterView keeps them
// in refs) — an inline arrow here would defeat the memo.
//
// A tile that cannot be sold is shown DISABLED WITH ITS REASON, never hidden: the cashier
// is hunting for the thing printed on the slip, and "it is not on the screen" reads as
// "I am missing it" rather than "it is sold out".

import { memo } from 'react'
import { Ban, SlidersHorizontal } from 'lucide-react'
import type { MenuCategory, MenuItem } from '@/lib/menu/types'
import { pickName, priceLabel, type Sellability } from '@/lib/pos/cart'
import { useT } from '@/lib/pos/useT'
import type { StrKey } from '@/lib/pos/i18n'

export type TileEntry = {
  id: string
  item: MenuItem
  category: MenuCategory
  sell: Sellability
  action: 'add-as-is' | 'needs-choices'
}

const REASON_KEY = {
  sold_out: 'register.tile.soldOut',
  no_point: 'register.tile.noPoint',
  not_sold: 'register.tile.notSold',
  no_price: 'register.tile.noPrice',
  modifier_unavailable: 'register.tile.optionOut',
} as const satisfies Record<string, StrKey>

type Props = {
  entry: TileEntry
  count: number
  lang: 'he' | 'en'
  isManager: boolean
  onAdd: (uid: string) => void
  onCustomize: (uid: string, full: boolean) => void
}

function ItemTileBase({ entry, count, lang, isManager, onAdd, onCustomize }: Props) {
  const t = useT()
  const { item, sell, action } = entry
  const uid = item.uid ?? ''
  const name = pickName(item, lang)
  const price = priceLabel(item)
  const choose = sell.sellable && action === 'needs-choices'

  const label = !sell.sellable
    ? `${name}, ${t(REASON_KEY[sell.reason])}`
    : `${name}${price ? `, ${price}` : ''}${count > 0 ? `, ${t('register.tile.inOrder', { n: count })}` : ''}`

  return (
    <div className={`reg-tile${!sell.sellable ? ' is-off' : ''}${count > 0 ? ' has-count' : ''}`}>
      <button
        type="button"
        className="reg-tile-main press"
        aria-label={label}
        aria-disabled={!sell.sellable || undefined}
        onClick={() => {
          if (!sell.sellable || !uid) return
          if (choose) onCustomize(uid, false)
          else onAdd(uid)
        }}
      >
        <span className="reg-tile-name">{name}</span>
        <span className="reg-tile-foot">
          {!sell.sellable ? (
            <span className="reg-tile-reason">
              <Ban size={14} aria-hidden="true" />
              <span>
                {t(REASON_KEY[sell.reason])}
                {sell.reason === 'no_point' && isManager && (
                  <span className="reg-tile-manager"> · {t('register.tile.noPointManager')}</span>
                )}
              </span>
            </span>
          ) : (
            <>
              <span className="reg-tile-price ltr-isolate">{price}</span>
              {choose && (
                <span className="reg-tile-choose">
                  <SlidersHorizontal size={14} aria-hidden="true" />
                  {t('register.tile.choose')}
                </span>
              )}
            </>
          )}
        </span>
        {count > 0 && (
          <span className="reg-tile-count ltr-isolate" aria-hidden="true">
            {count}
          </span>
        )}
      </button>
      {sell.sellable && action === 'add-as-is' && (
        <button
          type="button"
          className="reg-tile-adjust press"
          aria-label={t('register.tile.adjustFor', { name })}
          onClick={() => uid && onCustomize(uid, true)}
        >
          <SlidersHorizontal size={18} aria-hidden="true" />
          <span>{t('register.tile.adjust')}</span>
        </button>
      )}
    </div>
  )
}

export const ItemTile = memo(ItemTileBase)
