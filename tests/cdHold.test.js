// The owner's manual note/hold on a CD order, and what the customer receives.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'

describe('onQuoteRequestUpdated — owner notes and holds', () => {
  let fns, sent

  beforeAll(async () => {
    fns = await import('../functions/index.js')
    sent = fns.__sentMail
  })
  beforeEach(() => { sent.length = 0 })

  const ORDER = { uid: 'u1', email: 'band@example.com', name: 'Band', qty: 100, status: 'paid' }
  const update = (before, after) => fns.onQuoteRequestUpdated.run(
    { before: { data: () => ({ ...ORDER, ...before }) }, after: { data: () => ({ ...ORDER, ...after }) } },
    { params: { id: 'orderabc123' } },
  )

  it('emails a note without a hold, with replies going to the owner', async () => {
    await update({}, { ownerNote: 'Is the title spelled right?', ownerNoteId: 1 })
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe('band@example.com')
    expect(sent[0].subject).toMatch(/note about your CD order/)
    expect(sent[0].text).toContain('Is the title spelled right?')
    expect(sent[0].text).not.toMatch(/paused/)
    expect(sent[0].replyTo).toBe('zionomari@artsaturated.com')
  })

  it('tells the customer the order is paused when it goes on hold', async () => {
    await update({}, { status: 'on_hold', statusBeforeHold: 'paid', ownerNote: 'The tray art is cut off.', ownerNoteId: 2 })
    expect(sent).toHaveLength(1)
    expect(sent[0].text).toContain('The tray art is cut off.')
    expect(sent[0].text).toMatch(/paused until we hear from you/)
  })

  it('does not resend a note when something else on the order changes', async () => {
    const noted = { ownerNote: 'Old note', ownerNoteId: 3 }
    await update(noted, { ...noted, trackingNumber: 'x' })
    await update({ ...noted, status: 'paid' }, { ...noted, status: 'in_production' })
    expect(sent).toHaveLength(0)
  })

  it('sends a second note when the owner writes again', async () => {
    await update({ ownerNote: 'First', ownerNoteId: 4 }, { ownerNote: 'Second', ownerNoteId: 5 })
    expect(sent).toHaveLength(1)
    expect(sent[0].text).toContain('Second')
  })

  it('tells the customer when a held order resumes', async () => {
    await update({ status: 'on_hold' }, { status: 'in_production' })
    expect(sent).toHaveLength(1)
    expect(sent[0].subject).toMatch(/back in production/)
  })

  it('stays quiet if a held order is cancelled instead', async () => {
    await update({ status: 'on_hold' }, { status: 'cancelled' })
    expect(sent).toHaveLength(0)
  })

  it('still sends the normal ready email', async () => {
    await update({ status: 'in_production' }, { status: 'ready' })
    expect(sent).toHaveLength(1)
    expect(sent[0].subject).toMatch(/ready/)
  })

  it('ignores legacy quote requests with no account', async () => {
    await update({ uid: undefined }, { uid: undefined, ownerNote: 'x', ownerNoteId: 6 })
    expect(sent).toHaveLength(0)
  })
})
