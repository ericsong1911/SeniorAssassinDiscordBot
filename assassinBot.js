const { Client, GatewayIntentBits, MessageAttachment, EmbedBuilder } = require('discord.js');
const { SlashCommandBuilder } = require('@discordjs/builders');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const yaml = require('yaml');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

let config;
let db;
config = yaml.parse(fs.readFileSync('config.yml', 'utf8'));
db = new sqlite3.Database('assassin.db');

client.once('ready', () => {
  console.log('Assassin Bot is ready!');
  initializeDatabase();
});

function initializeDatabase() {
  db.run(`CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    discord_id TEXT UNIQUE,
    name TEXT,
    team_id INTEGER,
    is_alive BOOLEAN DEFAULT 1,
    FOREIGN KEY (team_id) REFERENCES teams (id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY,
    name TEXT,
    owner_id INTEGER,
    target_id INTEGER,
    FOREIGN KEY (owner_id) REFERENCES players (id),
    FOREIGN KEY (target_id) REFERENCES teams (id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS kills (
    id INTEGER PRIMARY KEY,
    assassin_id INTEGER,
    target_id INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (assassin_id) REFERENCES players (id),
    FOREIGN KEY (target_id) REFERENCES players (id)
  )`);
}

const commands = [
    new SlashCommandBuilder().setName('join').setDescription('Register for the game'),
    new SlashCommandBuilder().setName('create-team').setDescription('Create a new team').addStringOption(option => option.setName('name').setDescription('The name of the team').setRequired(true)),
    new SlashCommandBuilder().setName('join-team').setDescription('Request to join a team').addIntegerOption(option => option.setName('team').setDescription('The ID of the team to join').setRequired(true)),
    new SlashCommandBuilder().setName('leave-team').setDescription('Leave your current team'),
    new SlashCommandBuilder().setName('transfer-ownership').setDescription('Transfer team ownership to another player').addUserOption(option => option.setName('player').setDescription('The player to transfer ownership to').setRequired(true)),
    new SlashCommandBuilder().setName('kick-player').setDescription('Kick a player from your team').addUserOption(option => option.setName('player').setDescription('The player to kick').setRequired(true)),
    new SlashCommandBuilder().setName('start-game').setDescription('Start the game'),
    new SlashCommandBuilder().setName('report-assassination').setDescription('Report an assassination with evidence').addIntegerOption(option => option.setName('target').setDescription('The ID of the assassinated player').setRequired(true)).addAttachmentOption(option => option.setName('evidence').setDescription('Evidence of the assassination').setRequired(true)),
    new SlashCommandBuilder().setName('submit-dispute').setDescription('Submit a dispute for review').addStringOption(option => option.setName('dispute').setDescription('The details of the dispute').setRequired(true)),
    new SlashCommandBuilder().setName('resolve-dispute').setDescription('Resolve a dispute').addStringOption(option => option.setName('dispute_id').setDescription('The ID of the dispute to resolve').setRequired(true)).addStringOption(option => option.setName('resolution').setDescription('The resolution of the dispute').setRequired(true)),
    new SlashCommandBuilder().setName('leaderboard').setDescription('Display the current leaderboard'),
    new SlashCommandBuilder().setName('rules').setDescription('Display the game rules'),
    new SlashCommandBuilder().setName('player-list').setDescription('Display the list of players and their status'),
    new SlashCommandBuilder().setName('team-list').setDescription('Display the list of teams and their information'),
    new SlashCommandBuilder().setName('help').setDescription('Display the help message'),
  ];

const rest = new REST({ version: '9' }).setToken(config.bot.token);

(async () => {
try {
    console.log('Started refreshing application (/) commands.');

    await rest.put(
    Routes.applicationGuildCommands(config.bot.client_id, config.channels.guild_id),
    { body: commands },
    );

    console.log('Successfully reloaded application (/) commands.');
} catch (error) {
    console.error(error);
}
})();

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;
  
    const { commandName } = interaction;
  
    if (commandName === 'join') {
      await handlePlayerRegistration(interaction);
    } else if (commandName === 'create-team') {
      await handleTeamCreation(interaction);
    } else if (commandName === 'join-team') {
      await handleTeamJoining(interaction);
    } else if (commandName === 'leave-team') {
      await handleTeamLeaving(interaction);
    } else if (commandName === 'transfer-ownership') {
      await handleOwnershipTransfer(interaction);
    } else if (commandName === 'kick-player') {
      await handlePlayerKick(interaction);
    } else if (commandName === 'start-game') {
      await handleGameStart(interaction);
    } else if (commandName === 'report-assassination') {
      await handleAssassinationReport(interaction);
    } else if (commandName === 'submit-dispute') {
      await handleDisputeSubmission(interaction);
    } else if (commandName === 'resolve-dispute') {
      await handleDisputeResolution(interaction);
    } else if (commandName === 'leaderboard') {
      await displayLeaderboard(interaction);
    } else if (commandName === 'rules') {
      await displayRules(interaction);
    } else if (commandName === 'player-list') {
      await displayPlayerList(interaction);
    } else if (commandName === 'team-list') {
      await displayTeamList(interaction);
    } else if (commandName === 'help') {
    await displayHelp(interaction);
    }
  });

  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
  
  async function handlePlayerRegistration(interaction) {
    const userId = interaction.user.id;
  
    db.get('SELECT * FROM players WHERE discord_id = ?', [userId], (err, row) => {
      if (err) {
        console.error('Error checking player registration:', err);
        return interaction.reply('An error occurred while registering. Please try again later.');
      }
  
      if (row) {
        return interaction.reply('You are already registered for the game.');
      }
  
      const name = interaction.user.username;
      const playerId = Math.random().toString(36).substring(7); // Generate a unique player ID
  
      db.run('INSERT INTO players (id, discord_id, name) VALUES (?, ?, ?)', [playerId, userId, name], (err) => {
        if (err) {
          console.error('Error registering player:', err);
          return interaction.reply('An error occurred while registering. Please try again later.');
        }
  
        interaction.reply(`You have been successfully registered for the game! Your player ID is: ${playerId}`);
      });
    });
  }
  
  async function handleTeamCreation(interaction) {
    const userId = interaction.user.id;
  
    db.get('SELECT * FROM players WHERE discord_id = ?', [userId], (err, row) => {
      if (err) {
        console.error('Error checking player:', err);
        return interaction.reply('An error occurred while creating a team. Please try again later.');
      }
  
      if (!row) {
        return interaction.reply('You must be registered for the game to create a team.');
      }
  
      const teamName = interaction.options.getString('name');
  
      db.run('INSERT INTO teams (name, owner_id) VALUES (?, ?)', [teamName, row.id], function(err) {
        if (err) {
          console.error('Error creating team:', err);
          return interaction.reply('An error occurred while creating a team. Please try again later.');
        }
  
        const teamId = this.lastID;
  
        db.run('UPDATE players SET team_id = ? WHERE id = ?', [teamId, row.id], (err) => {
          if (err) {
            console.error('Error updating player team:', err);
            return interaction.reply('An error occurred while creating a team. Please try again later.');
          }
  
          interaction.reply(`Team "${teamName}" has been created and you have been added as the owner!`);
        });
      });
    });
  }
  
  async function handleTeamJoining(interaction) {
    const userId = interaction.user.id;
    const teamId = interaction.options.getInteger('team');
  
    db.get('SELECT * FROM players WHERE discord_id = ?', [userId], (err, playerRow) => {
      if (err) {
        console.error('Error checking player:', err);
        return interaction.reply('An error occurred while joining a team. Please try again later.');
      }
  
      if (!playerRow) {
        return interaction.reply('You must be registered for the game to join a team.');
      }
  
      db.get('SELECT * FROM teams WHERE id = ?', [teamId], (err, teamRow) => {
        if (err) {
          console.error('Error checking team:', err);
          return interaction.reply('An error occurred while joining a team. Please try again later.');
        }
  
        if (!teamRow) {
          return interaction.reply('The specified team does not exist.');
        }
  
        if (playerRow.team_id) {
          return interaction.reply('You are already a member of a team.');
        }
  
        const ownerId = teamRow.owner_id;
  
        interaction.reply(`Your request to join team "${teamRow.name}" has been sent to the team owner.`);
  
        // Send a join request message to the team owner
        client.users.fetch(ownerId)
          .then((owner) => {
            const embed = new EmbedBuilder()
              .setTitle('Team Join Request')
              .setDescription(`${interaction.user.username} has requested to join your team "${teamRow.name}".`)
              .setFooter('Please use the buttons below to approve or reject the request.');
  
            const approveButton = {
              type: 2,
              style: 3,
              label: 'Approve',
              custom_id: `approve_join_${playerRow.id}_${teamId}`,
            };
  
            const rejectButton = {
              type: 2,
              style: 4,
              label: 'Reject',
              custom_id: `reject_join_${playerRow.id}_${teamId}`,
            };
  
            const actionRow = {
              type: 1,
              components: [approveButton, rejectButton],
            };
  
            owner.send({ embeds: [embed], components: [actionRow] });
          })
          .catch((err) => {
            console.error('Error sending join request to team owner:', err);
            interaction.followUp('An error occurred while sending the join request to the team owner. Please try again later.');
          });
      });
    });
  }
  
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
  
    const [action, playerId, teamId] = interaction.customId.split('_');
  
    if (action === 'approve') {
      db.run('UPDATE players SET team_id = ? WHERE id = ?', [teamId, playerId], (err) => {
        if (err) {
          console.error('Error updating player team:', err);
          return interaction.reply('An error occurred while approving the join request. Please try again later.');
        }
  
        interaction.reply(`Player has been added to your team!`);
  
        client.users.fetch(playerId)
          .then((player) => {
            player.send(`Your request to join the team has been approved!`);
          })
          .catch((err) => {
            console.error('Error sending approval message to player:', err);
          });
      });
    } else if (action === 'reject') {
      interaction.reply(`Join request has been rejected.`);
  
      client.users.fetch(playerId)
        .then((player) => {
          player.send(`Your request to join the team has been rejected.`);
        })
        .catch((err) => {
          console.error('Error sending rejection message to player:', err);
        });
    }
  });
  
  async function handleTeamLeaving(interaction) {
    const userId = interaction.user.id;
  
    db.get('SELECT * FROM players WHERE discord_id = ?', [userId], (err, playerRow) => {
      if (err) {
        console.error('Error checking player:', err);
        return interaction.reply('An error occurred while leaving the team. Please try again later.');
      }
  
      if (!playerRow) {
        return interaction.reply('You are not registered for the game.');
      }
  
      if (!playerRow.team_id) {
        return interaction.reply('You are not a member of any team.');
      }
  
      const teamId = playerRow.team_id;
  
      db.get('SELECT * FROM teams WHERE id = ?', [teamId], (err, teamRow) => {
        if (err) {
          console.error('Error checking team:', err);
          return interaction.reply('An error occurred while leaving the team. Please try again later.');
        }
  
        if (!teamRow) {
          return interaction.reply('The specified team does not exist.');
        }
  
        if (teamRow.owner_id === playerRow.id) {
          // If the player is the team owner, transfer ownership to the next oldest member
          db.get('SELECT * FROM players WHERE team_id = ? AND id != ? ORDER BY id LIMIT 1', [teamId, playerRow.id], (err, newOwnerRow) => {
            if (err) {
              console.error('Error finding new team owner:', err);
              return interaction.reply('An error occurred while leaving the team. Please try again later.');
            }
  
            if (newOwnerRow) {
              db.run('UPDATE teams SET owner_id = ? WHERE id = ?', [newOwnerRow.id, teamId], (err) => {
                if (err) {
                  console.error('Error updating team owner:', err);
                  return interaction.reply('An error occurred while leaving the team. Please try again later.');
                }
  
                interaction.reply(`You have left the team and ownership has been transferred to ${newOwnerRow.name}.`);
  
                db.run('UPDATE players SET team_id = NULL WHERE id = ?', [playerRow.id], (err) => {
                  if (err) {
                    console.error('Error removing player from team:', err);
                  }
                });
              });
            } else {
              // If there are no other team members, delete the team
              db.run('DELETE FROM teams WHERE id = ?', [teamId], (err) => {
                if (err) {
                  console.error('Error deleting team:', err);
                  return interaction.reply('An error occurred while leaving the team. Please try again later.');
                }
  
                interaction.reply(`You have left the team and the team has been disbanded.`);
  
                db.run('UPDATE players SET team_id = NULL WHERE id = ?', [playerRow.id], (err) => {
                  if (err) {
                    console.error('Error removing player from team:', err);
                  }
                });
              });
            }
          });
        } else {
          // If the player is not the team owner, simply remove them from the team
          db.run('UPDATE players SET team_id = NULL WHERE id = ?', [playerRow.id], (err) => {
            if (err) {
              console.error('Error removing player from team:', err);
              return interaction.reply('An error occurred while leaving the team. Please try again later.');
            }
  
            interaction.reply(`You have left the team.`);
          });
        }
      });
    });
  }
  
  async function handleOwnershipTransfer(interaction) {
    const userId = interaction.user.id;
    const newOwnerId = interaction.options.getUser('player').id;
  
    db.get('SELECT * FROM players WHERE discord_id = ?', [userId], (err, playerRow) => {
      if (err) {
        console.error('Error checking player:', err);
        return interaction.reply('An error occurred while transferring ownership. Please try again later.');
      }
  
      if (!playerRow) {
        return interaction.reply('You are not registered for the game.');
      }
  
      if (!playerRow.team_id) {
        return interaction.reply('You are not a member of any team.');
      }
  
      const teamId = playerRow.team_id;
  
      db.get('SELECT * FROM teams WHERE id = ?', [teamId], (err, teamRow) => {
        if (err) {
          console.error('Error checking team:', err);
          return interaction.reply('An error occurred while transferring ownership. Please try again later.');
        }
  
        if (!teamRow) {
          return interaction.reply('The specified team does not exist.');
        }
  
        if (teamRow.owner_id !== playerRow.id) {
          return interaction.reply('You must be the team owner to transfer ownership.');
        }
  
        db.get('SELECT * FROM players WHERE discord_id = ? AND team_id = ?', [newOwnerId, teamId], (err, newOwnerRow) => {
          if (err) {
            console.error('Error checking new owner:', err);
            return interaction.reply('An error occurred while transferring ownership. Please try again later.');
          }
  
          if (!newOwnerRow) {
            return interaction.reply('The specified player is not a member of your team.');
          }
  
          db.run('UPDATE teams SET owner_id = ? WHERE id = ?', [newOwnerRow.id, teamId], (err) => {
            if (err) {
              console.error('Error updating team owner:', err);
              return interaction.reply('An error occurred while transferring ownership. Please try again later.');
            }
  
            interaction.reply(`Team ownership has been transferred to ${newOwnerRow.name}.`);
          });
        });
      });
    });
  }
  
  async function handlePlayerKick(interaction) {
    const userId = interaction.user.id;
    const playerId = interaction.options.getUser('player').id;
  
    // Check if the player is trying to kick themselves
    if (userId === playerId) {
      return interaction.reply('You cannot kick yourself from the team.');
    }
  
    db.get('SELECT * FROM players WHERE discord_id = ?', [userId], (err, playerRow) => {
      if (err) {
        console.error('Error checking player:', err);
        return interaction.reply('An error occurred while kicking the player. Please try again later.');
      }
  
      if (!playerRow) {
        return interaction.reply('You are not registered for the game.');
      }
  
      if (!playerRow.team_id) {
        return interaction.reply('You are not a member of any team.');
      }
  
      const teamId = playerRow.team_id;
  
      db.get('SELECT * FROM teams WHERE id = ?', [teamId], (err, teamRow) => {
        if (err) {
          console.error('Error checking team:', err);
          return interaction.reply('An error occurred while kicking the player. Please try again later.');
        }
  
        if (!teamRow) {
          return interaction.reply('The specified team does not exist.');
        }
  
        if (teamRow.owner_id !== playerRow.id) {
          return interaction.reply('You must be the team owner to kick players.');
        }
  
        db.get('SELECT * FROM players WHERE discord_id = ? AND team_id = ?', [playerId, teamId], (err, kickedPlayerRow) => {
          if (err) {
            console.error('Error checking kicked player:', err);
            return interaction.reply('An error occurred while kicking the player. Please try again later.');
          }
  
          if (!kickedPlayerRow) {
            return interaction.reply('The specified player is not a member of your team.');
          }
  
          db.run('UPDATE players SET team_id = NULL WHERE id = ?', [kickedPlayerRow.id], (err) => {
            if (err) {
              console.error('Error kicking player:', err);
              return interaction.reply('An error occurred while kicking the player. Please try again later.');
            }
  
            interaction.reply(`${kickedPlayerRow.name} has been kicked from the team.`);
          });
        });
      });
    });
  }

async function isGameManager(interaction) {
  const gameManagerRoleId = config.roles.game_manager;
  const member = await interaction.guild.members.fetch(interaction.user.id);
  return member.roles.cache.has(gameManagerRoleId);
}

async function handleGameStart(interaction) {
  const userId = interaction.user.id;
  const isAdmin = await isGameManager(interaction);

  db.get('SELECT * FROM players WHERE discord_id = ?', [userId], (err, playerRow) => {
    if (err) {
      console.error('Error checking player:', err);
      return interaction.reply('An error occurred while starting the game. Please try again later.');
    }

    if (!isAdmin) {
      return interaction.reply('You must be an admin to start the game.');
    }

    db.all('SELECT COUNT(*) as count FROM teams', (err, rows) => {
      if (err) {
        console.error('Error counting teams:', err);
        return interaction.reply('An error occurred while starting the game. Please try again later.');
      }

      const teamCount = rows[0].count;

      if (teamCount < config.game.min_team_count) {
        return interaction.reply(`A minimum of ${config.game.min_team_count} teams is required to start the game.`);
      }

      db.run('UPDATE game_state SET state = ?', ['active'], (err) => {
        if (err) {
          console.error('Error updating game state:', err);
          return interaction.reply('An error occurred while starting the game. Please try again later.');
        }

        assignTargets();
        startGameLoop();

        interaction.reply('The game has been started!');
      });
    });
  });
}

async function handleAssassinationReport(interaction) {
    const channel = interaction.channel;
    const assassinId = interaction.user.id;
    const targetId = interaction.options.getInteger('target');
    const evidenceImage = interaction.options.getAttachment('evidence');
  
    db.get('SELECT * FROM players WHERE discord_id = ?', [assassinId], (err, assassinRow) => {
      if (err) {
        console.error('Error checking assassin:', err);
        return interaction.reply('An error occurred while reporting the assassination. Please try again later.');
      }
  
      if (!assassinRow || !assassinRow.is_alive) {
        return interaction.reply('You must be an alive player to report an assassination.');
      }
  
      db.get('SELECT * FROM players WHERE id = ?', [targetId], (err, targetRow) => {
        if (err) {
          console.error('Error checking target:', err);
          return interaction.reply('An error occurred while reporting the assassination. Please try again later.');
        }
  
        if (!targetRow || !targetRow.is_alive) {
          return interaction.reply('The specified target is not an alive player.');
        }
  
        const assassinationId = Math.random().toString(36).substring(7); // Generate a unique assassination ID
  
        const embed = new EmbedBuilder()
          .setTitle('Assassination Report')
          .setDescription(`Assassin: ${interaction.user.username}\nTarget: ${targetRow.name}`)
          .setImage(evidenceImage.url)
          .setFooter({ text: `Assassination ID: ${assassinationId} | Please vote on whether to approve or reject the assassination.` });
  
        const approveButton = {
          type: 2,
          style: 3,
          label: 'Approve',
          custom_id: `approve_assassination_${assassinationId}`,
        };
  
        const rejectButton = {
          type: 2,
          style: 4,
          label: 'Reject',
          custom_id: `reject_assassination_${assassinationId}`,
        };
  
        const actionRow = {
          type: 1,
          components: [approveButton, rejectButton],
        };
  
        channel.send({ embeds: [embed], components: [actionRow] });
        interaction.reply('Your assassination report has been submitted for voting.');
      });
    });
  }

async function handleDisputeSubmission(interaction) {
const channel = interaction.guild.channels.cache.get(config.channels.disputes);
const userId = interaction.user.id;
const dispute = interaction.options.getString('dispute');

db.get('SELECT * FROM players WHERE discord_id = ?', [userId], (err, playerRow) => {
    if (err) {
    console.error('Error checking player:', err);
    return interaction.reply('An error occurred while submitting the dispute. Please try again later.');
    }

    if (!playerRow) {
    return interaction.reply('You must be a registered player to submit a dispute.');
    }

    const disputeId = Math.random().toString(36).substring(7); // Generate a unique dispute ID

    const embed = new EmbedBuilder()
    .setTitle('Dispute Submission')
    .setDescription(`Submitted by: ${interaction.user.username}\n\n${dispute}`)
    .setFooter({ text: `Dispute ID: ${disputeId}` });

    channel.send({ embeds: [embed] });
    interaction.reply('Your dispute has been submitted for review.');
});
}

async function handleDisputeResolution(interaction) {
  const channel = interaction.guild.channels.cache.get(config.channels.disputes);
  const userId = interaction.user.id;
  const disputeId = interaction.options.getString('dispute_id');
  const resolution = interaction.options.getString('resolution');
  const isAdmin = await isGameManager(interaction);

  db.get('SELECT * FROM players WHERE discord_id = ?', [userId], (err, playerRow) => {
    if (err) {
      console.error('Error checking player:', err);
      return interaction.reply('An error occurred while resolving the dispute. Please try again later.');
    }

    if (!isAdmin) {
      return interaction.reply('You must be an admin to resolve disputes.');
    }

    channel.messages.fetch(disputeId)
      .then((message) => {
        const embed = new EmbedBuilder()
          .setTitle('Dispute Resolution')
          .setDescription(`Dispute ID: ${disputeId}\nResolved by: ${interaction.user.username}\n\n${resolution}`);
        message.reply({ embeds: [embed] });
        interaction.reply('The dispute has been resolved.');
      })
      .catch((err) => {
        console.error('Error fetching dispute message:', err);
        interaction.reply('An error occurred while resolving the dispute. Please check the dispute ID and try again.');
      });
  });
}

async function displayLeaderboard(interaction) {
  const channel = interaction.guild.channels.cache.get(config.channels.leaderboard);

  db.all('SELECT t.name AS team_name, COUNT(k.id) AS kills FROM teams t LEFT JOIN players p ON t.id = p.team_id LEFT JOIN kills k ON p.id = k.assassin_id GROUP BY t.id ORDER BY kills DESC', (err, rows) => {
    if (err) {
      console.error('Error fetching leaderboard data:', err);
      return interaction.reply('An error occurred while displaying the leaderboard. Please try again later.');
    }

    let leaderboard = 'Leaderboard:\n\n';
    rows.forEach((row, index) => {
      leaderboard += `${index + 1}. ${row.team_name} - ${row.kills} kills\n`;
    });

    const embed = new EmbedBuilder()
      .setTitle('Assassin Game Leaderboard')
      .setDescription(leaderboard);

    channel.send({ embeds: [embed] });
    interaction.reply('The leaderboard has been updated.');
  });
}

async function displayRules(interaction) {
  const rulesFile = fs.readFileSync(config.rules_file, 'utf8');
  const embed = new EmbedBuilder()
    .setTitle('Assassin Game Rules')
    .setDescription(rulesFile);

  interaction.reply({ embeds: [embed] });
}

async function displayPlayerList(interaction) {
  db.all('SELECT p.name, t.name AS team_name, p.is_alive FROM players p LEFT JOIN teams t ON p.team_id = t.id', (err, rows) => {
    if (err) {
      console.error('Error fetching player list:', err);
      return interaction.reply('An error occurred while displaying the player list. Please try again later.');
    }

    let playerList = 'Player List:\n\n';
    rows.forEach((row) => {
      playerList += `ID: ${row.id} | ${row.name} - Team: ${row.team_name || 'None'}, Status: ${row.is_alive ? 'Alive' : 'Eliminated'}\n`;
    });

    const embed = new EmbedBuilder()
      .setTitle('Assassin Game Player List')
      .setDescription(playerList);

    interaction.reply({ embeds: [embed] });
  });
}

async function displayTeamList(interaction) {
    db.all('SELECT t.id, t.name, p.name AS owner_name, COUNT(p2.id) AS member_count FROM teams t LEFT JOIN players p ON t.owner_id = p.id LEFT JOIN players p2 ON t.id = p2.team_id GROUP BY t.id', (err, rows) => {
      if (err) {
        console.error('Error fetching team list:', err);
        return interaction.reply('An error occurred while displaying the team list. Please try again later.');
      }
  
      let teamList = 'Team List:\n\n';
      rows.forEach((row) => {
        teamList += `ID: ${row.id} | ${row.name} - Owner: ${row.owner_name}, Members: ${row.member_count}\n`;
      });
  
      const embed = new EmbedBuilder()
        .setTitle('Assassin Game Team List')
        .setDescription(teamList);
  
      interaction.reply({ embeds: [embed] });
    });
  }

async function displayHelp(interaction) {
    const helpMessage = `
      Assassin Game Bot Commands:
      
      /join - Register for the game
      /create-team <name> - Create a new team
      /join-team <team> - Request to join a team
      /leave-team - Leave your current team
      /transfer-ownership <player> - Transfer team ownership to another player
      /kick-player <player> - Kick a player from your team (team owner only)
      /start-game - Start the game (admin only)
      /report-assassination <target> <evidence> - Report an assassination with evidence
      /submit-dispute <dispute> - Submit a dispute for review
      /resolve-dispute <dispute_id> <resolution> - Resolve a dispute (admin only)
      /leaderboard - Display the current leaderboard
      /rules - Display the game rules
      /player-list - Display the list of players and their status
      /team-list - Display the list of teams and their information
      /help - Display this help message
    `;
  
    const embed = new EmbedBuilder()
      .setTitle('Assassin Game Help')
      .setDescription(helpMessage);
  
    interaction.reply({ embeds: [embed] });
  }

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.channel.id === config.channels.voting) {
    if (message.attachments.size === 0) {
      await message.delete();
      return;
    }

    const attachment = message.attachments.first();
    const assassination = {
      assassin_id: message.author.id,
      target_id: null,
      evidence_url: attachment.url,
    };

    db.run('INSERT INTO assassinations (assassin_id, evidence_url) VALUES (?, ?)', [assassination.assassin_id, assassination.evidence_url], (err) => {
      if (err) {
        console.error('Error inserting assassination:', err);
        return message.reply('An error occurred while processing the assassination. Please try again later.');
      }

      const embed = new EmbedBuilder()
        .setTitle('Assassination Evidence')
        .setDescription(`Submitted by: ${message.author.username}`)
        .setImage(attachment.url)
        .setFooter('Please vote on whether to approve or reject the assassination.');

      const approveButton = {
        type: 2,
        style: 3,
        label: 'Approve',
        custom_id: `approve_assassination_${message.id}`,
      };

      const rejectButton = {
        type: 2,
        style: 4,
        label: 'Reject',
        custom_id: `reject_assassination_${message.id}`,
      };

      const actionRow = {
        type: 1,
        components: [approveButton, rejectButton],
      };

      message.reply({ embeds: [embed], components: [actionRow] });
    });
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  const [action, assassinationId] = interaction.customId.split('_');

  if (action === 'approve') {
    db.get('SELECT * FROM assassinations WHERE id = ?', [assassinationId], (err, row) => {
      if (err) {
        console.error('Error fetching assassination:', err);
        return interaction.reply('An error occurred while processing the assassination. Please try again later.');
      }

      if (!row) {
        return interaction.reply('The specified assassination does not exist.');
      }

      const assassinId = row.assassin_id;
      const targetId = row.target_id;

      db.run('UPDATE players SET is_alive = 0 WHERE id = ?', [targetId], (err) => {
        if (err) {
          console.error('Error updating player status:', err);
          return interaction.reply('An error occurred while processing the assassination. Please try again later.');
        }

        db.run('INSERT INTO kills (assassin_id, target_id) VALUES (?, ?)', [assassinId, targetId], (err) => {
          if (err) {
            console.error('Error inserting kill:', err);
            return interaction.reply('An error occurred while processing the assassination. Please try again later.');
          }

          interaction.update({ content: 'The assassination has been approved.', components: [] });
          updateLeaderboard();
        });
      });
    });
  } else if (action === 'reject') {
    interaction.update({ content: 'The assassination has been rejected.', components: [] });
  }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
  
    const [action, assassinationId] = interaction.customId.split('_');
  
    if (action === 'approve') {
      db.get('SELECT * FROM assassinations WHERE id = ?', [assassinationId], (err, row) => {
        if (err) {
          console.error('Error fetching assassination:', err);
          return interaction.reply('An error occurred while processing the assassination. Please try again later.');
        }
  
        if (!row) {
          return interaction.reply('The specified assassination does not exist.');
        }
  
        const assassinId = row.assassin_id;
        const targetId = row.target_id;
  
        db.run('UPDATE players SET is_alive = 0 WHERE id = ?', [targetId], (err) => {
          if (err) {
            console.error('Error updating player status:', err);
            return interaction.reply('An error occurred while processing the assassination. Please try again later.');
          }
  
          db.run('INSERT INTO kills (assassin_id, target_id) VALUES (?, ?)', [assassinId, targetId], (err) => {
            if (err) {
              console.error('Error inserting kill:', err);
              return interaction.reply('An error occurred while processing the assassination. Please try again later.');
            }
  
            interaction.update({ content: `The assassination (ID: ${assassinationId}) has been approved.`, components: [] });
            updateLeaderboard();
          });
        });
      });
    } else if (action === 'reject') {
      interaction.update({ content: `The assassination (ID: ${assassinationId}) has been rejected.`, components: [] });
    }
  });

  function updateGameState() {
    const now = new Date();
    const endDate = new Date(config.game.end_date);
  
    if (now >= endDate) {
      db.run('UPDATE game_state SET state = ?', ['ended'], (err) => {
        if (err) {
          console.error('Error updating game state:', err);
          return;
        }
  
        db.all('SELECT t.id, t.name AS team_name, COUNT(k.id) AS kills FROM teams t LEFT JOIN players p ON t.id = p.team_id LEFT JOIN kills k ON p.id = k.assassin_id GROUP BY t.id ORDER BY kills DESC', (err, rows) => {
          if (err) {
            console.error('Error fetching team standings:', err);
            return;
          }
  
          if (rows.length === 1) {
            const winningTeam = rows[0];
            const channel = client.channels.cache.get(config.channels.status);
            channel.send(`The game has ended! The winning team is ${winningTeam.team_name} with ${winningTeam.kills} kills.`);
          } else if (rows.length > 1) {
            const tiedTeams = rows.filter((row) => row.kills === rows[0].kills);
            if (tiedTeams.length > 1) {
              const channel = client.channels.cache.get(config.channels.status);
              channel.send('The game has ended in a tie! Entering sudden death mode.');
  
              // Sudden death logic
              const suddenDeathTeams = tiedTeams.map((team) => team.id);
              const shuffledTeams = shuffle(suddenDeathTeams);
  
              for (let i = 0; i < shuffledTeams.length; i += 2) {
                const team1 = shuffledTeams[i];
                const team2 = shuffledTeams[i + 1];
  
                if (team2) {
                  db.run('UPDATE teams SET target_id = ? WHERE id = ?', [team2, team1], (err) => {
                    if (err) {
                      console.error('Error updating sudden death target for team', team1, err);
                    }
                  });
  
                  db.run('UPDATE teams SET target_id = ? WHERE id = ?', [team1, team2], (err) => {
                    if (err) {
                      console.error('Error updating sudden death target for team', team2, err);
                    }
                  });
                }
              }
  
              channel.send('Sudden death targets have been assigned. The first team to eliminate their target wins!');
            } else {
              const winningTeam = tiedTeams[0];
              const channel = client.channels.cache.get(config.channels.status);
              channel.send(`The game has ended! The winning team is ${winningTeam.team_name} with ${winningTeam.kills} kills.`);
            }
          } else {
            const channel = client.channels.cache.get(config.channels.status);
            channel.send('The game has ended with no winning team.');
          }
        });
      });
    }
  }

function assignTargets() {
  db.all('SELECT * FROM teams', (err, rows) => {
    if (err) {
      console.error('Error fetching teams:', err);
      return;
    }

    const teamIds = rows.map((row) => row.id);
    const shuffledTeamIds = shuffle(teamIds);

    for (let i = 0; i < shuffledTeamIds.length; i++) {
      const teamId = shuffledTeamIds[i];
      const targetId = shuffledTeamIds[(i + 1) % shuffledTeamIds.length];

      db.run('UPDATE teams SET target_id = ? WHERE id = ?', [targetId, teamId], (err) => {
        if (err) {
          console.error('Error updating team target:', err);
        }
      });
    }
  });
}

function updateLeaderboard() {
  const channel = client.channels.cache.get(config.channels.leaderboard);

  db.all('SELECT t.name AS team_name, COUNT(k.id) AS kills FROM teams t LEFT JOIN players p ON t.id = p.team_id LEFT JOIN kills k ON p.id = k.assassin_id GROUP BY t.id ORDER BY kills DESC', (err, rows) => {
    if (err) {
      console.error('Error fetching leaderboard data:', err);
      return;
    }

    let leaderboard = 'Leaderboard:\n\n';
    rows.forEach((row, index) => {
      leaderboard += `${index + 1}. ${row.team_name} - ${row.kills} kills\n`;
    });

    const embed = new EmbedBuilder()
      .setTitle('Assassin Game Leaderboard')
      .setDescription(leaderboard);

    channel.messages.fetch({ limit: 1 })
      .then((messages) => {
        const lastMessage = messages.first();

        if (lastMessage && lastMessage.author.id === client.user.id) {
          lastMessage.edit({ embeds: [embed] });
        } else {
          channel.send({ embeds: [embed] });
        }
      })
      .catch((err) => {
        console.error('Error fetching leaderboard message:', err);
      });
  });
}

function startGameLoop() {
  setInterval(() => {
    updateGameState();
  }, 60000);
}

client.login(config.bot.token);
