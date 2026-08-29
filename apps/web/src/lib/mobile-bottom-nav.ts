export const MOBILE_BOTTOM_NAV_VISIBILITY_EVENT = 'vibemux:mobile-bottom-nav-visibility'
export const MOBILE_SITE_HEADER_VISIBILITY_EVENT = 'vibemux:mobile-site-header-visibility'

export const setMobileBottomNavHidden = (hidden: boolean) => {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new CustomEvent(MOBILE_BOTTOM_NAV_VISIBILITY_EVENT, {
    detail: { hidden },
  }))
}

export const setMobileSiteHeaderHidden = (hidden: boolean) => {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new CustomEvent(MOBILE_SITE_HEADER_VISIBILITY_EVENT, {
    detail: { hidden },
  }))
}
