/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';
import { 
  Send, Hash, User, Wifi, WifiOff, 
  Lock, Shield, Terminal, Copy, Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const BROKER_URL = "wss://8499505b5a944d7fb9741e0ab74b8610.s1.eu.hivemq.cloud:8884/mqtt";
const DEFAULT_USER = "admin";
const DEFAULT_PASS = "Server123";

interface Message {
  id: string;
  sender: string;
  text: string;
  timestamp: string;
  isMe: boolean;
  type: 'chat' | 'system';
}

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState('');
  const [channel, setChannel] = useState('');
  const [password, setPassword] = useState('');
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [client, setClient] = useState<mqtt.MqttClient | null>(null);
  const [copyStatus, setCopyStatus] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const processedIds = useRef(new Set<string>());

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const connectMQTT = () => {
    if (!username.trim() || !channel.trim() || !password.trim()) return;
    
    const clientId = `keepcalm_${Math.random().toString(16).slice(2, 10)}`;
    const options = { clientId, username: DEFAULT_USER, password: DEFAULT_PASS, clean: true };
    const mqttClient = mqtt.connect(BROKER_URL, options);

    mqttClient.on('connect', () => {
      setIsConnected(true);
      setIsLoggedIn(true);
      // O tópico é uma combinação do canal e senha para criar uma "sala privada"
      const secureTopic = `keepcalm/${channel}_${password}/msg`;
      mqttClient.subscribe(secureTopic);
      addSystemMessage(`Sessão segura: ${channel}`);
    });

    mqttClient.on('message', (topic, payload) => {
      const raw = payload.toString();
      // Usamos um ID único na mensagem para evitar duplicidade
      const [msgId, sender, text] = raw.split('||');
      
      if (msgId && !processedIds.current.has(msgId)) {
        processedIds.current.add(msgId);
        setMessages(prev => [...prev, {
          id: msgId,
          sender, text,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isMe: sender === username,
          type: 'chat'
        }]);
      }
    });

    mqttClient.on('close', () => setIsConnected(false));
    setClient(mqttClient);
  };

  const sendMessage = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!client || !inputText.trim()) return;
    
    const msgId = Math.random().toString(36).substring(2, 15);
    const secureTopic = `keepcalm/${channel}_${password}/msg`;
    // Enviamos ID || Nome || Texto
    client.publish(secureTopic, `${msgId}||${username}||${inputText}`);
    setInputText('');
  };

  const addSystemMessage = (text: string) => {
    setMessages(prev => [...prev, {
      id: Math.random().toString(36),
      sender: 'SYS',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isMe: false,
      type: 'system'
    }]);
  };

  const copyInviteLink = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('channel', channel);
    navigator.clipboard.writeText(url.toString());
    setCopyStatus(true);
    setTimeout(() => setCopyStatus(false), 2000);
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#f5f5f5] font-mono">
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm bg-white border border-[#e0e0e0] shadow-sm overflow-hidden"
        >
          <div className="bg-[#fafafa] px-4 py-3 border-b border-[#eeeeee] flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#444]" />
            <span className="text-[10px] font-bold text-[#444] uppercase tracking-widest">KeepCalm Auth</span>
          </div>

          <div className="p-8 space-y-5">
            <div className="text-center mb-6">
              <h1 className="text-2xl font-light text-[#222] tracking-tighter">KeepCalm</h1>
              <p className="text-[9px] text-[#aaa] uppercase tracking-[0.3em] mt-1">Minimal Secure Chat</p>
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-[9px] font-bold text-[#999] uppercase mb-1">
                  <User className="w-3 h-3" /> Identidade
                </div>
                <input 
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-[#f9f9f9] border border-[#eee] px-3 py-2 text-sm focus:outline-none focus:border-[#222] transition-colors"
                  placeholder="Nome..."
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2 text-[9px] font-bold text-[#999] uppercase mb-1">
                  <Hash className="w-3 h-3" /> Canal
                </div>
                <input 
                  type="text"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                  className="w-full bg-[#f9f9f9] border border-[#eee] px-3 py-2 text-sm focus:outline-none focus:border-[#222] transition-colors"
                  placeholder="Nome do canal..."
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2 text-[9px] font-bold text-[#999] uppercase mb-1">
                  <Lock className="w-3 h-3" /> Senha de Acesso
                </div>
                <input 
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-[#f9f9f9] border border-[#eee] px-3 py-2 text-sm focus:outline-none focus:border-[#222] transition-colors"
                  placeholder="••••••••"
                />
              </div>

              <button 
                onClick={connectMQTT}
                className="w-full bg-[#222] text-white py-3 text-xs font-bold hover:bg-[#000] transition-all uppercase tracking-widest"
              >
                Entrar
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[#f5f5f5] font-mono p-4 md:p-8">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex-1 flex flex-col bg-white border border-[#e0e0e0] shadow-sm overflow-hidden max-w-4xl mx-auto w-full"
      >
        {/* Header Minimalista */}
        <div className="bg-[#fafafa] px-6 py-3 border-b border-[#eeeeee] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-xs font-bold text-[#222] tracking-widest uppercase">
              KeepCalm / {channel}
            </h2>
          </div>
          
          <div className="flex items-center gap-4">
            <button 
              onClick={copyInviteLink}
              className="text-[9px] font-bold text-[#999] hover:text-[#222] transition-colors uppercase tracking-tighter flex items-center gap-1"
            >
              {copyStatus ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
              {copyStatus ? 'Copiado' : 'Link'}
            </button>
            <div className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`} title={isConnected ? "Online" : "Offline"} />
          </div>
        </div>

        {/* Chat */}
        <main 
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-6 space-y-4 bg-white"
        >
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className={`flex flex-col ${msg.type === 'system' ? 'items-center' : 'items-start'}`}
              >
                {msg.type === 'system' ? (
                  <div className="text-[#ccc] text-[8px] uppercase tracking-[0.4em] my-4">
                    {msg.text}
                  </div>
                ) : (
                  <div className="max-w-full w-full">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className={`text-[9px] font-bold uppercase ${msg.isMe ? 'text-[#222]' : 'text-[#999]'}`}>
                        {msg.isMe ? 'Eu' : msg.sender}
                      </span>
                      <span className="text-[8px] text-[#ddd]">{msg.timestamp}</span>
                    </div>
                    <div className={`text-sm leading-relaxed border-l border-[#eee] pl-4 py-1 text-[#444]`}>
                      {msg.text}
                    </div>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </main>

        {/* Input */}
        <footer className="p-6 border-t border-[#eeeeee]">
          <form onSubmit={sendMessage} className="flex gap-4">
            <input 
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Escrever..."
              className="flex-1 bg-transparent text-sm focus:outline-none text-[#222] placeholder-[#ddd]"
            />
            <button 
              type="submit"
              className="text-[#222] hover:text-[#000] transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </footer>
      </motion.div>
    </div>
  );
}
