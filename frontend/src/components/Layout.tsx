import type { ReactNode } from 'react'
import BottomNav from './BottomNav'
import ChatbotButton from './ChatbotButton'

type LayoutProps = {
  title: string
  right?: ReactNode
  children: ReactNode
  hideNav?: boolean
}

export default function Layout(props: LayoutProps) {
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

      {!props.hideNav && <BottomNav />}
      <ChatbotButton />
    </div>
  )
}