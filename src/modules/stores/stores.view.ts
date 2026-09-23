import type { payment_links, stores } from '../../generated/prisma/client';

export type StoreWithLink = stores & { link: payment_links | null };

/** DB row → the store object of docs/api.md (public id as `id`, ISO timestamps, no internal ids). */
export function toStoreResponse(s: StoreWithLink) {
  return {
    id: s.public_id,
    name: s.name,
    external_id: s.external_id,
    city: s.city,
    status: s.status,
    support_email: s.support_email,
    redirect_success_url: s.redirect_success_url,
    redirect_failure_url: s.redirect_failure_url,
    telegram_chat_id: s.telegram_chat_id,
    brand_color: s.brand_color,
    logo_image_url: s.logo_image_url,
    whitelabel_css: s.whitelabel_css,
    link: s.link && {
      link_type: s.link.link_type,
      raw_link: s.link.raw_link,
      merchant_account_id: s.link.merchant_account_id,
      merchant_name: s.link.merchant_name,
      currency: s.link.currency,
      verified_at: s.link.verified_at?.toISOString() ?? null,
      status: s.link.status,
    },
    created_at: s.created_at.toISOString(),
  };
}
