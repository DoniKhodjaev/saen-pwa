import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/e2e', timeout:45000, expect:{timeout:10000}, workers:2, forbidOnly:!!process.env.CI,
  use:{baseURL:'http://127.0.0.1:4173',trace:'retain-on-failure'},
  webServer:{command:'node tests/dev-server.mjs',url:'http://127.0.0.1:4173/app/',reuseExistingServer:false},
  projects:[
    {name:'chromium-mobile',use:{...devices['Pixel 7'],browserName:'chromium',launchOptions:process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--single-process','--no-zygote','--use-gl=angle','--use-angle=swiftshader','--disable-gpu']} : undefined}},
    {name:'webkit-iphone',use:{...devices['iPhone 13'],browserName:'webkit'}},
  ],
});
