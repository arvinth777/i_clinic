export function LoadingRows({ label = 'Loading…' }: { label?: string }) {
  return <div className="loading-rows" role="status" aria-label={label}>{[0, 1, 2].map(row => <div className="loading-row" key={row} aria-hidden="true"><span /><span /></div>)}</div>
}

export function QueryError({ retry, savedAt }: { retry: () => void; savedAt?: number }) {
  return <div className="query-error" role="alert"><div><strong>Couldn't refresh this view.</strong><p>{savedAt ? `Showing the copy saved at ${new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : 'Check your connection and try again.'}</p></div><button className="ui-button ui-button-neutral" onClick={retry}>Try again</button></div>
}
