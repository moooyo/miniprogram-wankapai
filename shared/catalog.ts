import type { Bank, Issuer, Network } from './contracts';
export const banks: Bank[] = [
  { id:'cmb', name:'招商银行', shortName:'招行', logo:'/assets/banks/cmb.png' },
  { id:'hsbc', name:'汇丰银行', shortName:'汇丰', logo:'/assets/banks/hsbc.png' },
  { id:'boc', name:'中国银行', shortName:'中行', logo:'/assets/banks/boc.png' },
  { id:'icbc', name:'工商银行', shortName:'工行', logo:'/assets/banks/icbc.png' },
  { id:'ccb', name:'建设银行', shortName:'建行', logo:'/assets/banks/ccb.png' },
  { id:'abc', name:'农业银行', shortName:'农行', logo:'/assets/banks/abc.png' },
  { id:'bocom', name:'交通银行', shortName:'交行', logo:'/assets/banks/bocom.png' },
  { id:'psbc', name:'邮储银行', shortName:'邮储', logo:'/assets/banks/psbc.png' },
  { id:'spdb', name:'浦发银行', shortName:'浦发', logo:'/assets/banks/spdb.png' },
  { id:'citic', name:'中信银行', shortName:'中信', logo:'/assets/banks/citic.png' },
  { id:'pab', name:'平安银行', shortName:'平安', logo:'/assets/banks/pab.png' },
  { id:'cib', name:'兴业银行', shortName:'兴业', logo:'/assets/banks/cib.png' },
];
export const issuers: Issuer[] = [
  {id:'cmb-cn',bankId:'cmb',name:'招商银行'},
  {id:'hsbc-hk',bankId:'hsbc',name:'汇丰香港'},
  {id:'hsbc-cn',bankId:'hsbc',name:'汇丰中国'},
  {id:'boc-cn',bankId:'boc',name:'中国银行（内地）'},
  {id:'boc-hk',bankId:'boc',name:'中银香港'},
  {id:'boc-mo',bankId:'boc',name:'中国银行澳门分行'},
  ...['icbc','ccb','abc','bocom','psbc','spdb','citic','pab','cib'].map(bankId=>({id:bankId+'-cn',bankId,name:banks.find(bank=>bank.id===bankId)!.name})),
];
export const networks: {id:Network;name:string}[] = [
  {id:'visa',name:'Visa'},{id:'mastercard',name:'Mastercard'},
  {id:'unionpay',name:'银联'},{id:'amex',name:'American Express'},{id:'other',name:'其他'},
];
