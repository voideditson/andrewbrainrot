/* Data shared by the server and the browser. Add new brainrots at the END of SP so saves keep working. */
(function(){
var RAR=[
  {n:'Common',c:'#c9d1de',w:65},{n:'Uncommon',c:'#5be37d',w:23.4},{n:'Epic',c:'#b968ff',w:7},
  {n:'Legendary',c:'#ffb02e',w:3},{n:'Mythic',c:'#ff4f7b',w:1},{n:'Ultra',c:'#4fe8ff',w:0.5},{n:'Secret',c:'rainbow',w:0.1}
];
var SP=[
  {n:'Nicho-Loco-Motivo',r:0,p:25,i:.5,k:'loco',c1:0xd9363e,c2:0xffd23f},
  {n:'Nick Nick Boom Boom Son',r:0,p:50,i:1,k:'bomb',c1:0x2c2f44,c2:0xff3d3d},
  {n:'Detentiondilo Nicholsondilo',r:0,p:90,i:1.7,k:'detcroc',c1:0x5aa545,c2:0x2c6b2a},
  {n:'Patapim Nicholsonim',r:0,p:140,i:2.5,k:'stump',c1:0x8a5a2b,c2:0x5d3a1a},
  {n:'Professor Nicholaroni Pepperoni',r:0,p:200,i:3.5,k:'pizza',c1:0xffc247,c2:0xd33b2c},
  {n:'Bombardiro Nicholdilo',r:1,p:300,i:4,k:'bomber',c1:0x6b8f3a,c2:0x3f5a24},
  {n:'Tung Tung Tung Mr Nickeh',r:1,p:450,i:6.5,k:'log',c1:0xc48a45,c2:0x7a4a22},
  {n:'Nicholodon the Homeworkodon',r:1,p:650,i:9,k:'homework',c1:0x3fb6a8,c2:0x2e8a80},
  {n:'Mr Nickelsandsons',r:1,p:900,i:12.5,k:'coin',c1:0xffc928,c2:0xe0a21a},
  {n:'Sigmason Nicholsonius',r:1,p:1300,i:18,k:'sigma',c1:0xe9e6df,c2:0xcfcfd9},
  {n:'Tralalero Nicholalero',r:2,p:2500,i:30,k:'shark',c1:0x5a8fd6,c2:0x2f5fa8},
  {n:'Nichozilla Maximum',r:2,p:4000,i:46,k:'kaiju',c1:0x2f7d4a,c2:0x1d4d2f,scale:1.1},
  {n:'Nicholsonuccino Cappuccino',r:2,p:6000,i:70,k:'cup',c1:0xfff6ea,c2:0x7a4a2a},
  {n:'Mr Ohio Nicholsonio',r:3,p:12000,i:120,k:'ohio',c1:0x6b2d12,c2:0xe0a867},
  {n:'Brr Brr Nicholbrrr',r:3,p:18000,i:180,k:'yeti',c1:0xcfeeff,c2:0x5fb4e6},
  {n:'Rizzolson Pepperonison',r:3,p:28000,i:280,k:'rizz',c1:0xff8a7a,c2:0x3a1a14},
  {n:'Nicholskibidi',r:4,p:80000,i:600,k:'throne',c1:0xf8fbff,c2:0xffd23f},
  {n:'Professor Yapolson',r:4,p:140000,i:1050,k:'yap',c1:0x8e5cff,c2:0x3b1a8c},
  {n:'Tung Tung Tung Ticholson',r:5,p:400000,i:2500,k:'ultralog',c1:0x5a3a1e,c2:0x4fe8ff,scale:1.1},
  {n:'Mr Nicholgyatt',r:6,p:1500000,i:7500,k:'gyatt',c1:0xffffff,c2:0xffffff,scale:1.1,rainbow:1},
  {n:'Andrewlini Spaghettison',r:0,p:110,i:2,k:'spag',c1:0xffe08a,c2:0xd33b2c},
  {n:'Mr Andrew Cactusson',r:0,p:170,i:3,k:'cactus',c1:0x3fae5a,c2:0xff7aa3},
  {n:'Andrewpillar Nicholsonpillar',r:1,p:550,i:8,k:'worm',c1:0x7bd34a,c2:0xff8a3d},
  {n:'Chimpanzini Andrewini',r:1,p:1000,i:14,k:'banana',c1:0xffd93d,c2:0x7a4a2a},
  {n:'Lirili Andrewla Nicholsonla',r:2,p:3200,i:38,k:'ele',c1:0x5fb85a,c2:0xffd23f},
  {n:'Andrewcopter Nicholsonator',r:2,p:5200,i:58,k:'copter',c1:0xe84a5f,c2:0x2b2f4a},
  {n:'Sir Andrew Nicholsonnnn',r:3,p:15000,i:150,k:'knight',c1:0xb8c2d6,c2:0xd0213a},
  {n:'Andrewtron 9000 Nicholson',r:3,p:24000,i:240,k:'robot',c1:0x9aa5b8,c2:0xff9f1c},
  {n:'Mr Andrew Nicholson',r:4,p:110000,i:850,k:'mrandrew',c1:0x1b1b30,c2:0xffd23f},
  {n:'Andrewgalaxy Nicholsonverse',r:5,p:550000,i:3400,k:'galaxy',c1:0x5b3fd6,c2:0x4fe8ff},
  {n:'Mr Andrew Nicholson Prime',r:6,p:2500000,i:11000,k:'mrandrew',c1:0xffffff,c2:0xffffff,scale:1.15,rainbow:1}
];
var PLAN=[{side:-1,cz:25},{side:1,cz:25},{side:-1,cz:-25},{side:1,cz:-25},{side:-1,cz:75},{side:1,cz:75},{side:-1,cz:-75},{side:1,cz:-75}];
var BH={RAR:RAR,SP:SP,PLAN:PLAN,
  PITY:{3:600,4:1200,5:2700,6:3600},
  WALK_X:7,ENT_X:15,BASE_D:40,BASE_W:30,ZLEN:100,BELT:4.5,ROWS:[9,20,31]};
if(typeof module!=='undefined'&&module.exports)module.exports=BH;else window.BH=BH;
})();
