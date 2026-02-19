import Layout from '../components/Layout'

export default function Settings() {
  return (
    <Layout title='Settings'>
      <div className='card' style={{ padding: 16 }}>
        <div className='h2'>Configuration</div>
        <div className='small' style={{ marginTop: 8 }}>
          预留：后续接 ConfigFacet（模式开关、阈值、风险策略等）
        </div>
      </div>
    </Layout>
  )
}
