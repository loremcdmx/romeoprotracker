export default function MarathonChartControls({ period, setPeriod, grouping, setGrouping, t, count }) {
  return <>
    <div className="section-head mc-chart-head">
      <h2 className="section-title">{t('chart_marathon')}</h2>
      <div className="mc-periods">
        {[['week', t('period_week')], ['month', t('period_month')], ['all', t('period_all')]].map(([key, label]) =>
          <button type="button" key={key} onClick={() => setPeriod(key)} className={`mc-period ${period === key ? 'active' : ''}`} aria-pressed={period === key}>{label}</button>)}
      </div>
      <span className="section-count">{count}</span>
    </div>
    <div className="mc-chart-controls">
      <label className="mc-group-control" htmlFor="marathon-grouping">
        {t('chart_step')}
        <select id="marathon-grouping" value={grouping} aria-label={t('chart_grouping_label')} onChange={e => setGrouping(e.target.value)}>
          <option value="sessions">{t('chart_sessions')}</option>
          <option value="months">{t('chart_months')}</option>
        </select>
      </label>
    </div>
  </>
}
