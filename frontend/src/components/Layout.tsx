import { ReactNode } from 'react'
import BottomNav from './BottomNav'
import ChatbotButton from './ChatbotButton'

export default function Layout(props: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className='shell'>
      <div className='topbar'>
        <div className='brand'>
          <div className='dot' />
          <div>
            <div className='h2'>{props.title}</div>
            <div className='small'>AI Smart Contract Wallet (AA + Diamond)</div>
          </div>
        </div>
        {props.right}
      </div>

      {props.children}

      <BottomNav />
      <ChatbotButton />
    </div>
  )
}
