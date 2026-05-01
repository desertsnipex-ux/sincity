require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

console.log("--- SinCity Discord Diagnostic ---");
console.log("Checking environment variables...");
console.log("GUILD_ID:", process.env.DISCORD_GUILD_ID ? "Found" : "MISSING");
console.log("ROLE_ID:", process.env.DISCORD_WHITELIST_ROLE_ID ? "Found" : "MISSING");
console.log("BOT_TOKEN:", process.env.DISCORD_BOT_TOKEN ? "Found" : "MISSING");

const client = new Client({ 
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] 
});

client.on('ready', async () => {
  console.log(`\n✅ SUCCESS: Bot is logged in as ${client.user.tag}`);
  
  try {
    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    console.log(`✅ SUCCESS: Found server: ${guild.name}`);
    
    const role = await guild.roles.fetch(process.env.DISCORD_WHITELIST_ROLE_ID);
    if (role) {
      console.log(`✅ SUCCESS: Found role: ${role.name}`);
      
      const botMember = await guild.members.fetch(client.user.id);
      console.log(`\n--- Permission Check ---`);
      console.log(`Bot has "Manage Roles": ${botMember.permissions.has('ManageRoles')}`);
      console.log(`Bot Role Position: ${botMember.roles.highest.position}`);
      console.log(`Target Role Position: ${role.position}`);
      
      if (botMember.roles.highest.position <= role.position) {
        console.log(`❌ ERROR: Bot role is LOWER than the Whitelisted role. Drag the bot role to the top in Discord settings.`);
      } else {
        console.log(`✅ SUCCESS: Role hierarchy is correct.`);
      }
    } else {
      console.log(`❌ ERROR: Could not find role. Check your DISCORD_WHITELIST_ROLE_ID.`);
    }
  } catch (err) {
    console.log(`❌ ERROR: ${err.message}`);
    if (err.message.includes("Privileged intent")) {
      console.log("\n💡 SOLUTION: You MUST enable 'Server Members Intent' in the Discord Developer Portal.");
    }
  }
  process.exit();
});

client.login(process.env.DISCORD_BOT_TOKEN).catch(err => {
  console.log(`❌ LOGIN FAILED: ${err.message}`);
  process.exit();
});
