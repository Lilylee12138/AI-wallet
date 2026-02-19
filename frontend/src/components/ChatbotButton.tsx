export default function ChatbotButton() {
  // 预留：后续接入 LLM chatbot 浮窗
  return (
    <button
      className='chatbot'
      onClick={() => alert('Chatbot placeholder: 后续接入 LLM 浮窗')}
      title='AI Assistant'
    >
      AI
    </button>
  )
}
