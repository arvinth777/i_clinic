import { useEffect, useState } from 'react'

export type StepperSection = { id: string; label: string }

// Pure jump-navigation, confirmed explicitly over a gated wizard: clicking
// a step scrolls to its anchor, nothing is ever hidden, and no step is
// ever marked "done" -- there's no actual completion order being
// enforced here, so a checkmark would just be a false signal.
//
// Click behavior is 'instant', not 'smooth' -- caught live: this page's
// background query refetches (the doctor queue polls every few seconds)
// re-render mid-animation and silently reset an in-progress smooth
// scroll before it completes, so a click would sometimes visibly do
// nothing. An instant jump can't be interrupted the same way.
//
// Active-step tracking is a plain scroll listener on .shell-content
// (the app's real scroll container, not the window) comparing each
// section's own getBoundingClientRect().top against a fixed threshold --
// the standard scroll-spy algorithm (last section whose top has crossed
// the line wins), not IntersectionObserver's "does it overlap this band"
// -- the first version of this used IntersectionObserver and got stuck
// on "Overview" for most of the page because that one section wraps four
// tall sub-sections and kept overlapping the observed band regardless of
// how far past it the doctor had actually scrolled.
export function SectionStepper({ sections }: { sections: StepperSection[] }) {
  const [active, setActive] = useState(sections[0]?.id)

  useEffect(() => {
    const scrollContainer = document.querySelector('.shell-content')
    if (!scrollContainer) return
    const threshold = 120

    function onScroll() {
      let activeId = sections[0]?.id
      for (const s of sections) {
        const top = document.getElementById(s.id)?.getBoundingClientRect().top
        if (top !== undefined && top <= threshold) activeId = s.id
      }
      setActive(activeId)
    }

    onScroll()
    scrollContainer.addEventListener('scroll', onScroll, { passive: true })
    return () => scrollContainer.removeEventListener('scroll', onScroll)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="section-stepper">
      {sections.map((s, i) => (
        <div key={s.id} className="stepper-item-wrap">
          <button
            type="button"
            className={active === s.id ? 'stepper-item stepper-item-active' : 'stepper-item'}
            onClick={() => {
              // Set active directly rather than waiting on the scroll
              // listener to infer it -- the click already knows exactly
              // which section it's targeting, so there's no reason to
              // depend on a scroll event actually following the jump.
              setActive(s.id)
              document.getElementById(s.id)?.scrollIntoView({ behavior: 'instant', block: 'start' })
            }}
          >
            <span className="stepper-dot">{i + 1}</span>
            <span className="stepper-label">{s.label}</span>
          </button>
          {i < sections.length - 1 && <span className="stepper-connector" aria-hidden="true" />}
        </div>
      ))}
    </div>
  )
}
