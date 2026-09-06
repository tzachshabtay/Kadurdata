create table if not exists core.player_identity_redirects (
  old_player_id uuid primary key,
  canonical_player_id uuid not null references core.players(id),
  old_display_name text not null,
  canonical_display_name text not null,
  reason text not null,
  merged_at timestamptz not null default now()
);

create index if not exists player_identity_redirects_canonical_idx
  on core.player_identity_redirects (canonical_player_id);

create temporary table player_identity_merges (
  old_player_id uuid primary key,
  canonical_player_id uuid not null,
  expected_old_name text not null,
  expected_canonical_name text not null,
  reason text not null,
  check (old_player_id <> canonical_player_id)
) on commit drop;

insert into player_identity_merges (
  old_player_id,
  canonical_player_id,
  expected_old_name,
  expected_canonical_name,
  reason
)
values
  -- Current Israeli domestic squads: FotMob roster identity -> 365Scores match identity.
  ('da9a9059-67c8-42b0-97ba-ecb56713b066', '876ca1c0-5370-4713-9996-e5c63b5545ea', 'Noam Muche', 'Noam Mucha', 'current squad alias'),
  ('c0262f61-189c-4e7e-a847-60c497de0d87', '5cb7c44e-0a5c-400f-b461-1fee299cb423', 'Roey Elimelech', 'Roei Elimelech', 'current squad alias'),
  ('4e04bf2b-f85c-47fa-bf0a-4aa4323a2c69', '08bef539-dd2e-4ba2-8c12-43c70a0ee7d8', 'Yan Shikut', 'Yan Shickut', 'current squad alias'),
  ('a3333403-2ff5-4497-9823-6674135d3f49', '5a509149-1973-4dc9-951e-5eadfb0807dd', 'Ahmad Hamam', 'Ahmad Haman', 'current squad alias'),
  ('6e13ada3-c0e6-4f6c-a76f-28d666ed7101', '7b84a7d6-8146-4703-b110-512f6749cfb1', 'Liam Nahum', 'Liam Nahum', 'current squad duplicate'),
  ('733955f5-7821-4a1b-9d9f-fa3cb48e843b', 'a6854a96-472b-47e3-9b8c-fba93c4e90cb', 'Waheb Habiballah', 'Wahib Habiballah', 'current squad alias'),
  ('092be41d-3ce1-4c86-9c0a-09157c1317bd', '589612ec-0c76-407d-a1f4-ded280ed5db2', 'William Agada', 'Willy Agada', 'current squad alias'),
  ('c3d1564a-5d93-435e-83df-5df97ddbcb54', '21e6bbe9-3d37-4958-ad4d-6788a2a9a980', 'Daniel', 'Daniel Tenenbaum', 'current squad verified by team shirt and role'),
  ('816de735-c7e9-4e98-8e94-9f19306e828c', '97d0bc11-9d03-40f7-a932-e4af0f0130cc', 'Jwan Al Halabi', 'Gwan Halabi', 'current squad alias'),
  ('082a6f8e-1e8b-49e2-8290-b5a0aa7437b3', 'bef8f802-35c2-4958-93cf-758982f739e5', 'Ido Vaier', 'Ido Vayer', 'current squad alias'),
  ('ece7b992-3e36-4425-af61-c3596b039a48', 'cd555a23-2a36-472e-9368-532ec14899da', 'Itzik Shoolmayster', 'Itzik Shulmeister', 'current squad alias'),
  ('2495fa95-a796-4f2c-aa99-6151bf98556a', 'dde369e6-e9b1-47ed-8766-30b13c5227b1', 'Nadav Markovitch', 'Nadav Markovich', 'current squad and loan alias'),
  ('cfc23849-44bf-454d-8ca1-0e375b1a3aa8', 'b0d0eeb0-c02b-4062-8821-2a90808e5322', 'Niv Michael Gabay', 'Niv Gabay', 'current squad and loan alias'),
  ('8056651c-006d-4785-b374-74fa81854281', 'f7c0bdf1-7f39-4ae8-af1e-1892dd70f5e4', 'Obeida Darwish', 'Ovadia Darwish', 'current squad alias'),
  ('7907c35c-6da0-452b-8872-aa258a0557aa', 'eb2543f6-51dd-4f6e-9506-199967ada8e0', 'Shon Edri', 'Sean Edri', 'current squad alias'),
  ('460a0ffa-f3b2-42e9-9ce4-bb0e9d0f614a', '38f3b46c-326f-4e03-a1b9-4b175ca2383c', 'Ilay Madmon', 'Elay Madmon', 'current squad alias'),
  ('1c7adb27-8ca6-49aa-80f9-20897b58c1c0', '3e4b59a0-83f8-4d00-b66d-d47eeb7a69a3', 'Israel Dapaah', 'Israel Dappa', 'current squad alias'),
  ('9cae858a-0ec2-464a-af4d-d1c79eb3ec0d', '898ec45f-23c3-4c48-8e2a-ff50ecc8768b', 'Lion Mizrachi', 'Li-On Mizrahi', 'current squad alias'),
  ('731b5af1-3c2f-40a5-aa02-3669e2b2d4fc', 'b6c85f6f-22f9-4a3d-be38-6bf9792af384', 'Nadeem Warasneh', 'Nadim Vrasana', 'current squad alias'),
  ('c7f746e3-91c9-4dea-b599-0479592a4948', '6f6bc1e9-e4f3-4d10-8650-55021dcdaa71', 'Netanel Shiferaw', 'Netanel Shprao', 'current squad alias'),
  ('a36e5b0b-7b24-4d12-ae21-cdb864f7550b', '6335a4a4-ca17-450f-b2dd-f1b59ae1a29b', 'Omer Agvadish', 'Omer Agbadish', 'current squad alias'),
  ('8ac4b5fd-da57-4842-84bc-ee9f61d19eb3', '1ead46df-49b8-49ba-88dd-3ee49cbce441', 'Yanai Distelfeld', 'Yanai Distalfeld', 'current squad alias'),
  ('3623f4b7-d496-4c1e-b532-3893e05ab1b3', '2152f1d5-8ad5-4720-a204-846407bed00c', 'Sharani Zuberu', 'Zuberu Sharani', 'current squad reversed name'),
  ('d9a3ac66-bb82-4511-9f1d-829c70709ce4', 'b6f4bf8a-0a06-4b42-b9ad-902254d1e058', 'Alex Moucketou-Moussounda', 'Alex Moussounda', 'current squad alias'),
  ('77acc4d9-e022-4572-95c3-7146b3813144', 'b960c4c5-b0df-4ad6-ba2c-5fbe9e4e41b3', 'Diego Arroyo', 'Diego Arroyo', 'current squad duplicate'),
  ('49e652f2-bb8e-47ad-8801-6d4472aea0a0', '06fe01e1-6f49-4b19-b0b5-de5264b611b6', 'Edmond Asante', 'Edmond Asante', 'current squad duplicate'),
  ('b50e2df5-5407-4776-b03e-8c30aca244fa', '29e8b1f9-80f0-4dd4-9e93-81e2a9e71bc4', 'Clé', 'Euclides Andrade Clé', 'current squad verified by team shirt and role'),
  ('4ec6e632-002f-40bf-8b80-8ba3250c2bbf', '0c44afac-3486-4319-b453-dbd3e0b7f535', 'Itay Ehud-Zaira', 'Itay Ehud', 'current squad alias'),
  ('356426eb-b52b-4b77-9b66-ec6564bd43b9', 'c86a9b62-a178-4bac-9d83-a97a80e649ca', 'Noam Cohen', 'Noam Cohen', 'current squad duplicate'),
  ('6cfcd78b-1413-4cf0-b0db-51e095d030cf', 'd43fd89c-08ef-4c86-bf8e-d22e0b453904', 'Yazen Nassar', 'Yazan Nassar', 'current squad alias'),
  ('1777cb23-1518-49e9-90f7-6650075e328c', '916e93d4-822c-4a23-83ab-558dd2144593', 'Falcão', 'Lucas Falcão', 'current squad verified by team shirt and role'),
  ('94b74bb3-2c0f-4115-87b4-e758bf0b1810', 'fd941459-5b93-4369-86a1-ce72af7cff81', 'Roei Alkukin', 'Roi Alkukin', 'current squad alias'),
  ('cc041651-c44b-49e9-a16d-2812dc9bc127', '72afc9c8-bac1-4251-b2c1-833ad3e0e712', 'Ariel Cohen', 'Ari Cohen', 'current squad verified by team shirt and role'),
  ('fa7202a4-80bd-4598-883c-876901065a5b', 'b533a9e3-a695-4957-8cbc-dfa0ecfab94e', 'Daniel Dzhulani', 'Daniel Golani', 'current squad and loan alias'),
  ('02ef34a1-5ce2-4424-ba42-20b4f5c12312', 'a505be49-b540-4c4e-9be9-d1ae53fe2247', 'Nehoray Hen', 'Nehoray Chen', 'current squad alias'),
  ('28f4d8c7-dfb6-4b55-a0fa-9f6c183199b0', '3839655f-a5b9-436a-9bb2-6f0d3d6d3e71', 'Qayes Ghanem', 'Qays Ghanem', 'current squad alias'),
  ('418430ca-8b34-4a24-8b5a-99de159be14b', 'c4ab81eb-4d3f-4e04-8e21-7f747757dcc0', 'Ali Muhammad', 'Ali Mohamed', 'current squad alias'),
  ('c5bf6473-1a7e-48ee-bbb5-2b187c342bdc', '33b43ff0-f0a8-4de9-8a6b-88c4a8cb829a', 'Cédric Don', 'Don Cedric', 'current squad reversed name'),
  ('05afc36b-8de4-4a88-bfc8-0073d07fb950', '6e304e48-e39c-4962-bd1b-9b80d7a16750', 'Ethane Azoulay', 'Eitan Azulay', 'current squad alias'),
  ('00b49357-f703-4f6e-bc49-23bd47f09d17', '12b7a77c-3405-4232-8e8a-2dcb6b2bf4a7', 'Zohar Zasano', 'Zohar Zasno', 'current squad alias'),
  ('73b69782-6ce4-4560-a114-8ea448852d3f', 'bb4c824d-8720-457a-8c35-6b2006f8d14f', 'Aziz Ouattara', 'Aziz Outtara', 'current squad alias'),
  ('6e5e81d4-8860-4dcb-8a3b-ce087f9a5f13', 'f257aee8-3d2a-45f3-b034-76976de66f7a', 'Nadav Niddam', 'Nadav Nidam', 'current squad alias'),
  ('8689d9e0-dc31-4f54-9ff8-fbc8704ef626', '2b5fa3e4-9fd1-41f2-b7e8-72b72bd3713b', 'Ariel Lugassy', 'Ariel Lugasi', 'current squad alias'),
  ('7a063f23-978f-44d8-9b4e-6f5f61b2cb92', 'd2d8f9fa-ffb4-4738-a1ee-cd4a8edb4bfa', 'Bashar Abdach', 'Bashar Ibdah', 'current squad alias'),
  ('af38fe37-0d85-4d03-89ad-293dd35a3cb3', '6297df6d-2a1b-4347-9f7f-489c3444f409', 'Eyal Einbrom', 'Eyal Inburum', 'current squad alias'),
  ('94600322-7d2f-491f-b384-968b2da73535', '5d825ad7-a33f-4171-ac3a-053f474151b6', 'Guy Deznet', 'Guy Dezent', 'current squad alias'),
  ('ea748762-f891-46b6-8d97-5e658b6c8cba', '40bb4888-a2b6-4b04-b671-b36595c14551', 'Pavlos Korrea', 'Pavlos Correa', 'current squad alias'),
  ('7e1921a9-ac36-4478-9aab-c094b891558f', '9a9fdf66-cde5-4412-ab80-5dac8090ff8a', 'Yehonatan Oz', 'Yehonatan Oz', 'current squad duplicate'),
  ('40913b5d-21e0-4eb0-a4fe-03587d59797b', '8720d94d-4343-45e4-bf47-806e349c26bf', 'Elai Ben Simon', 'Elay Ben Simon', 'current squad alias'),
  ('c79acd20-e175-4f3c-8d3e-85051ff739a7', 'b3bba426-e082-448f-bdbe-c6361caf339b', 'Mohamed Ali Camara', 'Mohamed Ali Kamara', 'current squad alias'),
  ('501146b7-b955-4d0c-833b-01e406fc4298', '6cfef46c-9b8d-417f-879e-b219d8ae012c', 'Roi Mishpati', 'Roei Mashpati', 'current squad alias'),

  -- Current outgoing-loan identities from two providers.
  ('76d8a455-da90-4f64-88b1-784b9787e185', 'b533a9e3-a695-4957-8cbc-dfa0ecfab94e', 'Daniel Joulani', 'Daniel Golani', 'current loan alias'),
  ('dbc1e12d-afa3-461f-95c4-5844a298ddc6', 'a1a340d8-e34c-4a31-9e0f-2395f93ad1f3', 'Gontie Junior Diomandé', 'Gontie Diomande', 'current loan alias'),
  ('b3578e2f-7ccd-4381-9147-5243b4ebb9b6', '91a0e333-1042-4b99-a8c5-25cdce3454de', 'Ran Meir', 'Ran Meir', 'current loan duplicate'),
  ('1352b81c-26a2-4275-a919-372dc813887e', '2466b734-b9c0-475b-84a1-33537172e9e1', 'Ravid Olezki', 'Ravid Ulitsky', 'current loan alias'),
  ('64dbd8c6-9150-4ff1-bd90-f922fddb7847', '79406a3a-51be-41dd-b2ce-29aa47ac31aa', 'Roy Navi', 'Roy Nawi', 'current loan alias'),
  ('9db18bc4-667f-4bb3-b950-c155437c3169', '8acfa69c-0e83-4da4-a25a-4bb34e0f7a44', 'Sarel Cohen', 'Sarel Shlomo Cohen', 'current loan alias'),
  ('15821a6c-cae1-48a8-b146-c733d75a9c2a', '58efeb3e-78c5-48c8-b2a1-9487dd0c8ccc', 'Ilay Tzairi', 'Illay Tzeiri', 'current roster and loan alias'),
  ('9b8c1b95-df3b-4633-adf3-051259ca4118', '4ffb2ad4-87ff-459e-9bec-8fc9b8c8de78', 'Roy Baranes', 'Roy Hen Baranes', 'current roster and loan alias'),

  -- Active 365Scores identities split between provider athlete and lineup identifiers.
  ('4f4f951e-8d1f-4120-bd4f-8d0a5847a90e', '7b84a7d6-8146-4703-b110-512f6749cfb1', 'Liam Nahum', 'Liam Nahum', '365Scores cross-competition identity split'),
  ('a5eac7f4-c6ec-4701-8d71-920a15d4e571', '7b84a7d6-8146-4703-b110-512f6749cfb1', 'Liam Nahum', 'Liam Nahum', '365Scores cross-competition identity split'),
  ('98a4bf16-5810-43fe-b4b1-aa2fe0edcc8d', '9a9fdf66-cde5-4412-ab80-5dac8090ff8a', 'Yehonatan Oz', 'Yehonatan Oz', '365Scores cross-competition identity split'),
  ('4e77b9fa-87d3-4cdd-b2f7-3b96dd522000', '91a0e333-1042-4b99-a8c5-25cdce3454de', 'Ran Meir', 'Ran Meir', '365Scores cross-competition identity split'),
  ('89aa4dce-0355-45fc-8593-b90956862751', '2466b734-b9c0-475b-84a1-33537172e9e1', 'Ravid Olezki', 'Ravid Ulitsky', '365Scores cross-competition identity split'),
  ('ac158d7a-0352-4ae4-a40c-61114d7ff819', '06a2bec6-647e-44e5-8a7d-c72ba1646683', 'Moataz Hamad', 'Moataz Hamad', '365Scores athlete and lineup split'),
  ('4719b627-5b2e-4549-8dc6-d97e7043ac7c', '0a0b4c64-0938-4cae-93f3-200334a74eda', 'Moshe Semel', 'Moshe Semel', '365Scores athlete and lineup split'),

  -- Other current-season 365Scores athlete and lineup identities.
  ('0f15124c-a4f9-45d6-b598-7ad38bd90846', '715f1298-cb2e-40fc-8232-1e313f03a8bd', 'Ofoeke Emmanuel', 'Ofoeke Emmanuel', '365Scores current-season identity split'),
  ('abbaeb69-4420-4ab5-8885-a52c53c7317e', 'c7709e50-2bbb-483f-9815-0a0c374607db', 'Eliya Ifrach', 'Eliya Ifrach', '365Scores current-season identity split'),
  ('2433b756-2cf4-4efb-95b5-8e08cb78d5a4', 'aefb861c-3a11-4738-a657-2caaf40f4a59', 'Erez Benodis', 'Erez Benodis', '365Scores current-season identity split'),
  ('fbbc14ca-54ce-4ace-9aad-b25c82ac6a2e', 'cf14a99a-bd46-4cfe-82e1-ab837f3987dd', 'Nitay Bitan', 'Nitay Bitan', '365Scores current-season identity split'),
  ('42856daa-872c-4872-92e0-1076cb3f767f', 'b078929e-b48f-4cc0-85ae-edeca08a20b5', 'Noam Ben Hamo', 'Noam Ben Hamo', '365Scores current-season identity split'),
  ('36f7bd30-ae07-4453-b138-3b04fbb9a08e', '5eff505a-e567-482a-9783-f12ba3d20f11', 'Orel Danan', 'Orel Danan', '365Scores current-season identity split'),
  ('a437a4e4-5f69-4f37-9568-5416fdf9bc37', 'd8a84f1c-dd1f-4da6-9ad4-3fdabaf07a06', 'Roei Rabinovich', 'Roei Rabinovich', '365Scores current-season identity split'),
  ('6ebf662d-1b3b-4964-a5ae-90ae991fdbd8', 'b8ae39d5-4b90-4f2d-9593-bd144dd17442', 'Roy Shedo', 'Roy Shedo', '365Scores current-season identity split'),
  ('5b861de1-1abd-4ef0-9f9c-c37b20889d83', '50d5fba7-6f68-4fa2-9161-636d7c55c7d7', 'Yhali Malka', 'Yhali Malka', '365Scores current-season identity split'),
  ('dc1863c7-2816-4026-9f42-17dc62f83f8e', 'c409d4e7-f162-495b-9e9d-0a3000048801', 'Eliran Zadok', 'Eliran Zadok', '365Scores current-season identity split'),
  ('6652a414-b127-4522-9456-5c5cf701cc11', '3d824281-debc-4387-b58e-220f64a3ed19', 'Niv Vaknin', 'Niv Vaknin', '365Scores current-season identity split'),
  ('e3c3cad3-159a-4dd3-b5de-b215daf9aa93', '3ba609df-abc2-464d-a95a-c6e6f2359d0f', 'Ofer Gelbard', 'Ofer Gelbard', '365Scores current-season identity split'),
  ('febb9813-69c6-4fe2-a8b5-e18e84110978', 'f8762154-8d92-42c1-9739-271fdbd547ac', 'Amit Nimni', 'Amit Nimni', '365Scores current-season identity split'),
  ('da9511f7-ed67-488e-9d2d-67190fd8464e', '306e0bac-9aa4-4a34-8c8a-e71c2c06e57f', 'Itay Barhoum', 'Itay Barhoum', '365Scores current-season identity split'),
  ('b8d45d78-fbdc-416d-9545-217ed15688bd', '2a324448-0db4-408b-94c5-2817dc69b432', 'Matan Beit-Ya''akov', 'Matan Beit Yaakov', '365Scores current-season identity split'),
  ('0f7373eb-fab5-4453-a5b6-915e5387e768', '26eb3d0b-d81c-4eba-9cbc-ca2de7fbd20f', 'Or Dasa', 'Or Dasa', '365Scores current-season identity split'),
  ('e82eff18-dde9-4bb2-8404-b900571b62e8', 'd2c8c036-a489-4b84-ad9b-99ffb3ec9be7', 'Ran Rival', 'Ran Rival', '365Scores current-season identity split'),
  ('8d90b7b2-c003-40b0-9c5e-018ab07d9c5a', '12fe6afb-5526-4d51-a2da-bba2803474ec', 'Ron Feldman', 'Ron Feldman', '365Scores current-season identity split'),
  ('a6bf7a0e-da20-47c2-bd0f-92970d115a18', '5485d3b5-4cfe-4b36-aa01-0452dda32fbc', 'Tedros Demelash', 'Tedros Demelash', '365Scores current-season identity split'),
  ('a44d59d7-456f-4090-a32c-e563ccaba842', '07cd056b-99fd-4c2d-87fc-f58999bbeaaf', 'Alon Demol', 'Alon Demol', '365Scores current-season identity split'),
  ('7122945f-89d2-4a1d-b7b9-63da60a6a10a', '152da7dc-d7c4-4ca5-9697-d8c490855db4', 'Erik Menesh', 'Erik Menesh', '365Scores current-season identity split'),
  ('e78ff271-c38e-46c5-867a-b82430a8a6b6', '7bb0a811-4734-4d39-81ee-ac20375d5938', 'Eliyahu Magar', 'Eliyahu Magar', '365Scores current-season identity split'),
  ('8e617a59-c644-4e2a-97da-77f86bb2ed67', '83e8a527-bb6d-455f-a03c-2b873d46a2a2', 'Eran Sasi', 'Eran Sasi', '365Scores current-season identity split'),
  ('9149591a-aad1-48e3-b227-339c95419ada', 'c1a4e318-703b-4ab4-84a6-29c9607514c0', 'Itamar Israeli', 'Itamar Israeli', '365Scores current-season identity split'),
  ('2b29de08-9af6-4e69-8e29-60e0a7bfa6f0', 'ba8490a4-8056-48a3-8a92-43a7b0a9369d', 'Maor Bitton', 'Maor Bitton', '365Scores current-season identity split'),
  ('abde0051-bc4b-4a31-89c4-3fa655625dd0', '54c1ba32-a181-4f6d-ba39-8fcbcb6b8379', 'Roy Beigel', 'Roy Beigel', '365Scores current-season identity split'),
  ('a2746263-98e7-4ead-bc91-78035f61ecb0', 'ec746b01-094b-4ceb-b7cf-a5428b17cc55', 'Shon Buskila', 'Shon Buskila', '365Scores current-season identity split'),
  ('cb56bb0c-c747-453d-8e43-36c2297bc5ae', '0d60702e-5951-45ed-8f6f-2ecfde3d9029', 'Yarin Shyovitz', 'Yarin Shyovitz', '365Scores current-season identity split'),
  ('544eab0f-2cbf-44f6-8338-63888977acda', '22de519c-bac6-4afa-9afd-e60f4a695502', 'Amougou Etongou', 'Amougou Etongou', '365Scores current-season identity split'),
  ('f6d72160-3446-4f02-8f6b-ba809a74b6da', '880b350b-b619-4c94-a19d-0b8b6c117601', 'Faris Egbaria', 'Faris Egbaria', '365Scores current-season identity split'),
  ('90afa761-a66f-4062-8bc8-45fac71adacd', '0ae4711f-20dc-4760-8c2d-13696bdf396a', 'Liran Turgeman', 'Liran Turgeman', '365Scores current-season identity split'),
  ('458ab278-a834-4abd-abc5-75b770af7d7e', '6249ed37-3ca7-4f14-91b8-c534450b692b', 'Yinon Ohana', 'Yinon Ohana', '365Scores current-season identity split'),
  ('2b31403c-ef1d-4dc8-bf7c-b7acc5169d90', '68c8575e-67e6-4746-ae3f-9aee9cb29ba3', 'Yehonatan Tsaig', 'Yehonatan Tsaig', '365Scores current-season identity split'),
  ('968f10d1-0039-44ea-b4a9-2ec2b6ed4550', 'aeb75f3d-686a-49f8-bd88-a7fda56c1c10', 'Amit Ben Kish', 'Amit Ben Kish', '365Scores current-season identity split'),
  ('0ab24bd9-5bb2-412e-8a38-fa28609f814f', 'e52c5110-2ce1-4e3b-aa4a-486ac7204c88', 'Daniel Maya', 'Daniel Maya', '365Scores current-season identity split'),
  ('1ce2b304-0b2d-4cf6-a6ba-eb33d19f18a8', 'f91671e6-56a3-480d-8952-e289e8e1e61d', 'Hamidou Hamza', 'Hamidou Hamza', '365Scores current-season identity split'),
  ('fa9bbca3-43e4-4124-ad57-e32d68eefa99', 'e9b76686-8b6e-4d2f-8514-f61080d5a40d', 'Ilay Mori', 'Ilay Mori', '365Scores current-season identity split'),
  ('ce294f8a-6ba8-4f50-820c-4ffd650cf5ce', '2fd9ca04-ae5e-4af5-8607-ea4f366c476e', 'Ilay Nachom', 'Ilay Nachom', '365Scores current-season identity split'),
  ('d5238882-cd1c-4a6f-a881-6fb62cd86a6d', 'a7c2854b-6aa5-4d30-a6fe-1d8e36f68d13', 'Rani Zeevi', 'Rani Zeevi', '365Scores current-season identity split'),
  ('3bb80482-c072-49e4-bb79-6f1e26d763f1', 'def6b6e3-c09c-4323-a66c-1039f7727ddb', 'Guy Weisinger', 'Guy Weisinger', '365Scores current-season identity split'),
  ('86f859c8-9723-42aa-a525-5bc0fded9540', '96a77687-ff5e-4ec9-b862-2fb4ed06337e', 'Idan Perez', 'Idan Perez', '365Scores current-season identity split'),
  ('a3d3f2e6-59a4-4c00-88d3-bc9c22fe5d4b', 'f9ae0dd1-e344-4763-b5a7-ae93396ff44b', 'Roy Shohat', 'Roy Shohat', '365Scores current-season identity split'),
  ('95e00a0f-d09c-4a0c-b3e2-efbaafa85d8f', 'd4f98a8e-434d-457c-83e0-c8c72cc78416', 'Idan Dadia', 'Idan Dadia', 'current roster and 365Scores identity split'),
  ('1ede56c8-531f-46d5-a47f-1945ce9cec7a', '8acfa69c-0e83-4da4-a25a-4bb34e0f7a44', 'Sarel Shlomo Cohen', 'Sarel Shlomo Cohen', 'current roster and loan duplicate'),
  ('63d8afb6-3a15-4203-88df-f1674b9dfced', '8acfa69c-0e83-4da4-a25a-4bb34e0f7a44', 'Sarel Cohen', 'Sarel Shlomo Cohen', 'current 365Scores and loan alias'),

  -- Audited active non-Israeli 365Scores athlete and lineup identities.
  ('54f2bbd0-b9ec-493a-8598-57a39573a3b1', 'bb5b67cb-e550-4300-9b5e-98bad290528f', 'Albin Omić', 'Albin Omić', '365Scores active athlete and lineup split'),
  ('9dcdbe06-6d19-4e88-bb1e-8c5d3df2e66f', '099861a0-a963-41da-870a-a986765d67a2', 'Aldin Mešić', 'Aldin Mešić', '365Scores active athlete and lineup split'),
  ('85858336-1fd4-4e76-9b18-bd1654d31991', '891f9951-12e6-4274-b544-c841541526d4', 'Amar Ibrišimović', 'Amar Ibrišimović', '365Scores active athlete and lineup split'),
  ('af61c374-975a-4d6c-9944-e3de752eaa27', 'd76d4689-67d5-453c-aed2-53a833601b38', 'Anes Krdžalić', 'Anes Krdžalić', '365Scores active athlete and lineup split'),
  ('28c166a7-f294-46fe-ac11-ea1af105ce52', '6effef32-bc2b-4eaa-b806-009c6b7c263b', 'Filip Taraba', 'Filip Taraba', '365Scores active athlete and lineup split'),
  ('a0171a83-46d8-4702-9fcf-5649def1fd8a', 'a50e63f9-0087-4d80-a310-973c26b3385e', 'Muhamed Buljubašić', 'Muhamed Buljubašić', '365Scores active athlete and lineup split'),
  ('c8dc8652-25bc-4d76-b3e0-1af319019f97', '7edac0de-f40f-47d8-8c94-6e4d62bbfe9c', 'Nedim Keranović', 'Nedim Keranović', '365Scores active athlete and lineup split'),
  ('2b87884d-496d-4c39-a9d2-b0392f4e362f', '33bd124a-3cb5-4e37-8339-bc31edd8ce52', 'Senad Mustafić', 'Senad Mustafic', '365Scores active athlete and lineup split'),
  ('4f96d280-8cff-4593-b08a-46e0814cbea3', '034b242c-7b6c-4ac5-9e50-4f919a8a049b', 'Dmitri Mandrîcenco', 'Dmitri Mandricenco', '365Scores active athlete and lineup split'),
  ('d3498e32-4699-4f70-9356-19ab8b2da73e', '034b242c-7b6c-4ac5-9e50-4f919a8a049b', 'Dmitri Mandrîcenco', 'Dmitri Mandricenco', '365Scores active athlete and lineup split'),

  -- Audited historical domestic 365Scores splits with a confirmed athlete identity.
  ('eb4dde87-949f-4eef-ace5-bb3c38043081', 'd3e3c61d-b638-46b8-85aa-4eb3fce212b8', 'Eilon Elimelech', 'Eilon Elimelech', '365Scores historical athlete and lineup split'),
  ('c6f33093-dd04-412b-9d61-6f6bc75297b5', 'c6b892ec-9f90-4f6e-a9db-3a26997704f1', 'Nir Lax', 'Nir Lax', '365Scores historical athlete and lineup split'),
  ('6c7db9ed-8170-49e2-bf09-f63bb04996e9', 'aea1a27c-a29a-432c-b1ce-234bf0811fda', 'Niv Fliter', 'Niv Fliter', '365Scores historical athlete and lineup split'),
  ('6dd179f5-41e2-4ef2-ad6c-32d126726e7c', '6b5ce7e8-4d21-4804-a9da-6f2bd12736db', 'Emmanuel Apeh', 'Emmanuel Apeh', '365Scores historical athlete and lineup split'),
  ('17538ce9-19cf-4e58-bbec-971b2331fc48', 'af81d7d4-5867-4b35-bd96-eb4c10f75823', 'Amit Zenati', 'Amit Zenati', '365Scores historical athlete and lineup split'),
  ('05f31ac1-5848-46a2-956c-3b07aaaeb791', '3cacb16a-5569-4abb-9914-955c9d7cc00c', 'Matar Dieye', 'Matar Dieye', '365Scores historical athlete and lineup split'),
  ('e28d76d2-f043-4597-92ce-2b108a8299cb', '73bb2020-657e-4076-b884-29a703ec23ca', 'Arad Bar', 'Arad Bar', '365Scores historical athlete and lineup split'),
  ('8a457c53-cd8b-40c2-9cb2-94a7d800cbd6', '754ebdb5-c2a9-4347-954e-bc39b37283ae', 'Ofek Fishler', 'Ofek Fishler', '365Scores historical athlete and lineup split'),
  ('4c216a64-a373-4303-b2e9-b45a2a7506fb', 'c56aeb79-8702-421a-844b-ce1919e963c9', 'Dor Kochav', 'Dor Kochav', '365Scores historical athlete and lineup split'),
  ('72f8cf11-1bd8-4e53-9ed6-709c1484a20d', '65a12777-8b8e-40c7-a4d8-46ce9a9ba259', 'Eliyahu Magar', 'Eliyahu Magar', '365Scores historical athlete and lineup split'),
  ('f0276f48-83b5-4bc0-98dd-e3394f2a603a', '3e67dd81-ea33-4ba0-a681-6e83e68cea2f', 'Magico Traore', 'Magico Traore', '365Scores historical athlete and lineup split'),
  ('aab17c02-4e08-4865-bb13-914328f9874f', '23baf3e0-f312-4c5e-b980-4f9c79e654b9', 'Isreal Nana Opoku', 'Isreal Nana Opoku', '365Scores historical athlete and lineup split'),

  -- Previously curated alias families that still had multiple core identities.
  ('2d917ad3-23f3-4be7-974f-e987f98eba11', '55455165-5313-4ccb-b8e7-b0651ab262a9', 'Awaka Eshata', 'Awka Ashta', 'existing curated alias'),
  ('b4a07e9d-375c-4ee3-a957-3d603cf5ea4f', 'd80512a5-bdb9-4dfc-b85a-8f59d8ab7fe0', 'Gabi Kanichowsky', 'Gabi Kanikovski', 'existing curated alias'),
  ('c755c5f2-3689-489b-98c8-794e446f9ea4', 'd80512a5-bdb9-4dfc-b85a-8f59d8ab7fe0', 'Gabi Kanichowsky', 'Gabi Kanikovski', 'existing curated alias'),
  ('be46d3c0-783f-4e7e-b4ae-e6cc0db35320', 'aee0b140-16d7-45dd-8877-4418156b0bcb', 'Hasan Hilu', 'Hassan Hilo', 'existing curated alias'),
  ('8f8415f2-b368-4511-96e1-d413067b35b0', '40d07d09-2745-4a5a-9e72-3362b9edd1de', 'Idan Toklomati', 'Idan Toklomaty', 'existing curated alias'),
  ('cd4c18b6-d963-4039-b57d-2bc7bcf9b290', 'a1244a14-0e3b-412d-b709-9daf20331aa4', 'Mahmoud Jaber', 'Mahmud Jaber', 'existing curated alias'),
  ('5533db0c-62e3-458f-986b-d80a5f94db9c', '397f2aaa-7770-4c5f-a4f6-87aadb8b170a', 'Tay Abed', 'Tai Abed', 'existing curated alias');

lock table
  core.players,
  core.player_team_stints,
  core.player_match_appearances,
  obs.player_appearance_observations,
  obs.player_match_stats,
  obs.events,
  obs.heatmaps,
  obs.player_valuation_series,
  obs.player_loans,
  obs.team_roster_memberships,
  source.source_entity_ids
in share row exclusive mode;

-- Snapshot every valuation primary-key collision created by the redirects. The
-- snapshot is validated and fully staged before any source series is deleted.
create temporary table player_valuation_collision_series on commit drop as
with projected_series as (
  select
    valuation.*,
    coalesce(merge.canonical_player_id, valuation.player_id) as target_player_id
  from obs.player_valuation_series valuation
  left join player_identity_merges merge on merge.old_player_id = valuation.player_id
  where valuation.player_id in (
    select old_player_id from player_identity_merges
    union
    select canonical_player_id from player_identity_merges
  )
), ranked_series as (
  select
    projected.*,
    count(*) over (
      partition by projected.source_id, projected.target_player_id, projected.source_player_id
    ) as projected_count
  from projected_series projected
)
select
  source_id,
  player_id,
  source_player_id,
  currency,
  provider,
  source_url,
  valuation_dates,
  value_amounts,
  lower_bounds,
  upper_bounds,
  observed_at,
  target_player_id
from ranked_series
where projected_count > 1;

create unique index player_valuation_collision_series_source_idx
  on player_valuation_collision_series (source_id, player_id, source_player_id);

create index player_valuation_collision_series_target_idx
  on player_valuation_collision_series (source_id, target_player_id, source_player_id);

create temporary table player_appearance_projection on commit drop as
with stat_quality as (
  select
    stats.appearance_id,
    max((
      select count(*)
      from jsonb_object_keys(jsonb_strip_nulls(
        to_jsonb(stats) - array['source_id', 'appearance_id', 'metric_count', 'observed_at']
      ))
    )) as stat_metric_count,
    max(stats.observed_at) as stat_observed_at
  from obs.player_match_stats stats
  group by stats.appearance_id
)
select
  appearance.id as appearance_id,
  appearance.match_id,
  appearance.player_id,
  appearance.team_id,
  appearance.opponent_team_id,
  appearance.side,
  appearance.shirt_number,
  appearance.lineup_status,
  appearance.position_name,
  appearance.formation_position,
  appearance.minutes_played,
  appearance.metadata,
  coalesce(merge.canonical_player_id, appearance.player_id) as target_player_id,
  coalesce(stat_quality.stat_metric_count, 0) as stat_metric_count,
  stat_quality.stat_observed_at
from core.player_match_appearances appearance
left join player_identity_merges merge on merge.old_player_id = appearance.player_id
left join stat_quality on stat_quality.appearance_id = appearance.id
where appearance.player_id in (
  select old_player_id from player_identity_merges
  union
  select canonical_player_id from player_identity_merges
);

create unique index player_appearance_projection_id_idx
  on player_appearance_projection (appearance_id);

create index player_appearance_projection_target_idx
  on player_appearance_projection (target_player_id, match_id, team_id);

create temporary table player_appearance_collision_members on commit drop as
with ranked as (
  select
    projected.*,
    count(*) over (
      partition by projected.target_player_id, projected.match_id, projected.team_id
    ) as collision_count,
    row_number() over (
      partition by projected.target_player_id, projected.match_id, projected.team_id
      order by
        (projected.player_id = projected.target_player_id) desc,
        projected.stat_metric_count desc,
        projected.minutes_played desc nulls last,
        projected.stat_observed_at desc nulls last,
        projected.appearance_id
    ) as member_rank
  from player_appearance_projection projected
)
select
  member.*,
  survivor.appearance_id as survivor_appearance_id
from ranked member
join ranked survivor
  on survivor.target_player_id = member.target_player_id
 and survivor.match_id = member.match_id
 and survivor.team_id = member.team_id
 and survivor.member_rank = 1
where member.collision_count > 1;

create unique index player_appearance_collision_members_id_idx
  on player_appearance_collision_members (appearance_id);

create index player_appearance_collision_members_survivor_idx
  on player_appearance_collision_members (survivor_appearance_id);

-- Some early 2026/27 lineup snapshots assigned one member's position slot to
-- another member. Each correction below was checked against a current
-- 365Scores game payload that directly links the listed lineup member ID to
-- the listed athlete ID. This is identity evidence independent of the stale
-- position labels, while keeping every exception bounded to one appearance.
create temporary table player_appearance_corrections (
  canonical_player_id uuid not null,
  match_id uuid not null,
  team_id uuid not null,
  source_game_id bigint not null,
  source_lineup_member_id bigint not null,
  source_athlete_id bigint not null,
  position_name text not null,
  formation_position text not null,
  primary key (canonical_player_id, match_id, team_id)
) on commit drop;

insert into player_appearance_corrections (
  canonical_player_id,
  match_id,
  team_id,
  source_game_id,
  source_lineup_member_id,
  source_athlete_id,
  position_name,
  formation_position
)
values
  ('07cd056b-99fd-4c2d-87fc-f58999bbeaaf', '356ab865-890c-46f2-8e37-c4d3e6f8a578', '44e32710-08d6-42b9-ac31-f8599db461cc', 4739175, 77435195, 220313, 'Defender', 'Centre Back'),
  ('07cd056b-99fd-4c2d-87fc-f58999bbeaaf', 'c7d46de8-6626-46b8-87a4-832f4294e8b6', '44e32710-08d6-42b9-ac31-f8599db461cc', 4739168, 77435195, 220313, 'Defender', 'Centre Back'),
  ('0ae4711f-20dc-4760-8c2d-13696bdf396a', 'ade8c73c-cce6-4cd0-b877-2522d711f6cc', '093dc3ca-a560-4512-b5af-8d029bbad5e0', 4739173, 77762956, 239111, 'Midfielder', 'Defensive Midfield'),
  ('0d60702e-5951-45ed-8f6f-2ecfde3d9029', 'a2e0e8f1-f6d4-42a3-801d-a3538f99fef4', '004a9ce9-406c-4230-9fca-ea1d81ade4c1', 4807670, 78340015, 244999, 'Midfielder', 'Defensive Midfield'),
  ('2466b734-b9c0-475b-84a1-33537172e9e1', '99e75874-c743-47fd-be1e-08113fa3cbf5', '6640b7fd-4f19-4874-a759-5ec8e8c9f21f', 4739166, 77656800, 230669, 'Attacker', 'Left Forward'),
  ('26eb3d0b-d81c-4eba-9cbc-ca2de7fbd20f', '120ebe6b-7549-412d-a4fc-512d38a91397', '454a6e07-09e8-4d0e-adc3-10818163e0da', 4739171, 1209126, 52753, 'Midfielder', 'Attacking Midfield'),
  ('26eb3d0b-d81c-4eba-9cbc-ca2de7fbd20f', '27f6d3d0-a5f8-44ce-aa08-5461d3086054', '454a6e07-09e8-4d0e-adc3-10818163e0da', 4739163, 1209126, 52753, 'Midfielder', 'Attacking Midfield'),
  ('2a324448-0db4-408b-94c5-2817dc69b432', '120ebe6b-7549-412d-a4fc-512d38a91397', '454a6e07-09e8-4d0e-adc3-10818163e0da', 4739171, 64904217, 106534, 'Attacker', 'Centre Forward'),
  ('2a324448-0db4-408b-94c5-2817dc69b432', '27f6d3d0-a5f8-44ce-aa08-5461d3086054', '454a6e07-09e8-4d0e-adc3-10818163e0da', 4739163, 64904217, 106534, 'Attacker', 'Centre Forward'),
  ('306e0bac-9aa4-4a34-8c8a-e71c2c06e57f', '120ebe6b-7549-412d-a4fc-512d38a91397', '454a6e07-09e8-4d0e-adc3-10818163e0da', 4739171, 78924965, 245439, 'Defender', 'Right Back'),
  ('306e0bac-9aa4-4a34-8c8a-e71c2c06e57f', '27f6d3d0-a5f8-44ce-aa08-5461d3086054', '454a6e07-09e8-4d0e-adc3-10818163e0da', 4739163, 78924965, 245439, 'Defender', 'Right Back'),
  ('3ba609df-abc2-464d-a95a-c6e6f2359d0f', '99e75874-c743-47fd-be1e-08113fa3cbf5', '6640b7fd-4f19-4874-a759-5ec8e8c9f21f', 4739166, 72686304, 159923, 'Defender', 'Left Back'),
  ('40bb4888-a2b6-4b04-b671-b36595c14551', 'a2e0e8f1-f6d4-42a3-801d-a3538f99fef4', 'd02d8b44-c223-45ba-b896-af5d3722634a', 4807670, 50483047, 102325, 'Defender', 'Centre Back'),
  ('68c8575e-67e6-4746-ae3f-9aee9cb29ba3', '8694ea1d-0d2c-47e4-a5fd-03df27ed0a8b', 'b2efcced-a9b6-454e-b984-08040fae6044', 4739172, 78924711, 245404, 'Defender', 'Right Back'),
  ('715f1298-cb2e-40fc-8232-1e313f03a8bd', '8694ea1d-0d2c-47e4-a5fd-03df27ed0a8b', '035caa29-5f2d-4c46-ae3e-5de9ad09e4c0', 4739172, 78924715, 245403, 'Midfielder', 'Defensive Midfield'),
  ('7bb0a811-4734-4d39-81ee-ac20375d5938', '99e75874-c743-47fd-be1e-08113fa3cbf5', '7f61b4a3-7091-4c6e-84c5-172c69e08fce', 4739166, 78925472, 245405, 'Midfielder', 'Central Midfield'),
  ('8acfa69c-0e83-4da4-a25a-4bb34e0f7a44', '99e75874-c743-47fd-be1e-08113fa3cbf5', '6640b7fd-4f19-4874-a759-5ec8e8c9f21f', 4739166, 77609410, 228120, 'Midfielder', 'Central Midfield'),
  ('ba8490a4-8056-48a3-8a92-43a7b0a9369d', '99e75874-c743-47fd-be1e-08113fa3cbf5', '7f61b4a3-7091-4c6e-84c5-172c69e08fce', 4739166, 64724922, 106523, 'Attacker', 'Centre Forward'),
  ('ba8490a4-8056-48a3-8a92-43a7b0a9369d', 'f9d2b783-c5f8-4346-8342-faa30da43887', '7f61b4a3-7091-4c6e-84c5-172c69e08fce', 4739167, 64724922, 106523, 'Attacker', 'Centre Forward'),
  ('c1a4e318-703b-4ab4-84a6-29c9607514c0', '99e75874-c743-47fd-be1e-08113fa3cbf5', '7f61b4a3-7091-4c6e-84c5-172c69e08fce', 4739166, 908096, 38047, 'Goalkeeper', 'Goalkeeper'),
  ('c1a4e318-703b-4ab4-84a6-29c9607514c0', 'f9d2b783-c5f8-4346-8342-faa30da43887', '7f61b4a3-7091-4c6e-84c5-172c69e08fce', 4739167, 908096, 38047, 'Goalkeeper', 'Goalkeeper'),
  ('d2c8c036-a489-4b84-ad9b-99ffb3ec9be7', '120ebe6b-7549-412d-a4fc-512d38a91397', '454a6e07-09e8-4d0e-adc3-10818163e0da', 4739171, 78924967, 245437, 'Midfielder', 'Central Midfield'),
  ('d2c8c036-a489-4b84-ad9b-99ffb3ec9be7', '27f6d3d0-a5f8-44ce-aa08-5461d3086054', '454a6e07-09e8-4d0e-adc3-10818163e0da', 4739163, 78924967, 245437, 'Midfielder', 'Central Midfield'),
  ('d43fd89c-08ef-4c86-bf8e-d22e0b453904', 'abca44d3-44f7-4efa-aa31-3260ded7583d', 'a3de4ba2-63b7-475e-9975-8f2bb118d546', 4807669, 53025848, 83718, 'Defender', 'Left Back'),
  ('d8a84f1c-dd1f-4da6-9ad4-3fdabaf07a06', 'e3372ba5-1fed-4d05-bdab-a2bb66c70afc', '90fd8f4a-b40a-48d9-ae96-fd6c6e47a896', 4739174, 77435285, 226000, 'Midfielder', 'Central Midfield'),
  ('e9b76686-8b6e-4d2f-8514-f61080d5a40d', 'ade8c73c-cce6-4cd0-b877-2522d711f6cc', '67611ed2-57da-40b1-a651-10eb54dcdeac', 4739173, 77656801, 230779, 'Defender', 'Right Back'),
  ('f91671e6-56a3-480d-8952-e289e8e1e61d', 'ade8c73c-cce6-4cd0-b877-2522d711f6cc', '67611ed2-57da-40b1-a651-10eb54dcdeac', 4739173, 78924556, 245419, 'Defender', 'Centre Back');

do $validation$
declare
  invalid_merge record;
begin
  select
    merge.*,
    old_player.display_name as actual_old_name,
    canonical_player.display_name as actual_canonical_name
  into invalid_merge
    from player_identity_merges merge
    left join core.players old_player on old_player.id = merge.old_player_id
    left join core.players canonical_player on canonical_player.id = merge.canonical_player_id
    where old_player.id is null
       or canonical_player.id is null
       or old_player.display_name <> merge.expected_old_name
       or canonical_player.display_name <> merge.expected_canonical_name
    limit 1;
  if found then
    raise exception
      'player identity merge audit mismatch: old % expected % actual %, canonical % expected % actual %',
      invalid_merge.old_player_id,
      invalid_merge.expected_old_name,
      invalid_merge.actual_old_name,
      invalid_merge.canonical_player_id,
      invalid_merge.expected_canonical_name,
      invalid_merge.actual_canonical_name;
  end if;

  with family_values as (
    select merge.canonical_player_id, player.date_of_birth as value
    from player_identity_merges merge
    join core.players player
      on player.id in (merge.old_player_id, merge.canonical_player_id)
    where player.date_of_birth is not null
  )
  select
    canonical_player_id,
    array_agg(distinct value order by value) as conflicting_values
  into invalid_merge
  from family_values
  group by canonical_player_id
  having count(distinct value) > 1
  limit 1;
  if found then
    raise exception 'player identity merge family % has conflicting birth dates: %',
      invalid_merge.canonical_player_id,
      invalid_merge.conflicting_values;
  end if;

  with family_values as (
    select merge.canonical_player_id, player.country_id as value
    from player_identity_merges merge
    join core.players player
      on player.id in (merge.old_player_id, merge.canonical_player_id)
    where player.country_id is not null
  )
  select
    canonical_player_id,
    array_agg(distinct value order by value) as conflicting_values
  into invalid_merge
  from family_values
  group by canonical_player_id
  having count(distinct value) > 1
  limit 1;
  if found then
    raise exception 'player identity merge family % has conflicting countries: %',
      invalid_merge.canonical_player_id,
      invalid_merge.conflicting_values;
  end if;

  if exists (
    select 1
    from player_identity_merges merge
    join player_identity_merges chained on chained.old_player_id = merge.canonical_player_id
  ) then
    raise exception 'player identity merge targets must be final canonical identities';
  end if;

  select
    target_player_id as canonical_player_id,
    match_id as old_value,
    array_agg(distinct team_id order by team_id) as conflicting_values
  into invalid_merge
  from player_appearance_projection
  group by target_player_id, match_id
  having count(distinct team_id) > 1
  limit 1;
  if found then
    raise exception 'player identity merge % appears for multiple teams in match %: %',
      invalid_merge.canonical_player_id,
      invalid_merge.old_value,
      invalid_merge.conflicting_values;
  end if;

  with appearance_scalar_values as (
    select
      member.target_player_id,
      member.match_id,
      member.team_id,
      field.field_name,
      field.field_value
    from player_appearance_collision_members member
    cross join lateral (
      values
        ('opponent_team_id', member.opponent_team_id::text),
        ('side', nullif(lower(btrim(member.side)), '')),
        ('shirt_number', case when member.shirt_number > 0 then member.shirt_number::text end),
        ('lineup_status', nullif(lower(btrim(member.lineup_status)), '')),
        ('position_name', nullif(lower(btrim(member.position_name)), '')),
        ('formation_position', nullif(lower(btrim(member.formation_position)), '')),
        ('minutes_played', member.minutes_played::text)
    ) as field(field_name, field_value)
    where field.field_value is not null
  ), appearance_scalar_conflicts as (
    select
      target_player_id as canonical_player_id,
      match_id,
      team_id,
      field_name,
      array_agg(distinct field_value order by field_value) as conflicting_values
    from appearance_scalar_values
    group by target_player_id, match_id, team_id, field_name
    having count(distinct field_value) > 1
  )
  select jsonb_agg(
    jsonb_build_object(
      'canonical_player_id', conflict.canonical_player_id,
      'match_id', conflict.match_id,
      'team_id', conflict.team_id,
      'field_name', conflict.field_name,
      'conflicting_values', conflict.conflicting_values
    ) order by
      conflict.canonical_player_id,
      conflict.match_id,
      conflict.team_id,
      conflict.field_name
  ) as conflicts
  into invalid_merge
  from appearance_scalar_conflicts conflict
  left join player_appearance_corrections correction
    on correction.canonical_player_id = conflict.canonical_player_id
   and correction.match_id = conflict.match_id
   and correction.team_id = conflict.team_id
  -- Only position fields can use an audited correction. The provider's
  -- current value must be one of exactly two observed values; opponent, side,
  -- shirt, lineup status, minutes, and every unlisted conflict remain fatal.
  where not (
    correction.canonical_player_id is not null
    and conflict.field_name in ('position_name', 'formation_position')
    and array_length(conflict.conflicting_values, 1) = 2
    and case conflict.field_name
      when 'position_name' then lower(correction.position_name)
      when 'formation_position' then lower(correction.formation_position)
    end = any(conflict.conflicting_values)
  )
  having count(*) > 0;
  if found then
    raise exception 'player identity merges have conflicting appearance fields: %',
      invalid_merge.conflicts;
  end if;

  with appearance_metric_values as (
    select
      member.target_player_id,
      member.match_id,
      member.team_id,
      stats.source_id,
      metric.key as metric_name,
      metric.value as metric_value
    from player_appearance_collision_members member
    join obs.player_match_stats stats
      on stats.appearance_id = member.appearance_id
    cross join lateral jsonb_each(
      jsonb_strip_nulls(
        to_jsonb(stats)
        - array[
            'source_id',
            'appearance_id',
            'metric_count',
            'observed_at'
          ]::text[]
      )
    ) as metric(key, value)
  )
  select
    target_player_id as canonical_player_id,
    match_id,
    team_id,
    source_id,
    metric_name,
    jsonb_agg(distinct metric_value order by metric_value) as conflicting_values
  into invalid_merge
  from appearance_metric_values
  group by target_player_id, match_id, team_id, source_id, metric_name
  having count(distinct metric_value) > 1
  limit 1;
  if found then
    raise exception
      'player identity merge % has conflicting metric % in match % for team % and source %: %',
      invalid_merge.canonical_player_id,
      invalid_merge.metric_name,
      invalid_merge.match_id,
      invalid_merge.team_id,
      invalid_merge.source_id,
      invalid_merge.conflicting_values;
  end if;

  select
    target_player_id as canonical_player_id,
    source_id as old_value,
    source_player_id as canonical_value,
    array_agg(distinct currency order by currency) as conflicting_values
  into invalid_merge
  from player_valuation_collision_series
  group by target_player_id, source_id, source_player_id
  having count(distinct currency) > 1
  limit 1;
  if found then
    raise exception 'player identity merge % has conflicting valuation currencies for source % and player key %: %',
      invalid_merge.canonical_player_id,
      invalid_merge.old_value,
      invalid_merge.canonical_value,
      invalid_merge.conflicting_values;
  end if;

  with valuation_points as (
    select
      series.target_player_id,
      series.source_id,
      series.source_player_id,
      point.valuation_date,
      point.value_amount,
      point.lower_bound,
      point.upper_bound
    from player_valuation_collision_series series
    cross join lateral unnest(
      series.valuation_dates,
      series.value_amounts,
      series.lower_bounds,
      series.upper_bounds
    ) as point(valuation_date, value_amount, lower_bound, upper_bound)
  )
  select
    target_player_id as canonical_player_id,
    source_id as old_value,
    source_player_id as canonical_value,
    valuation_date as conflict_date
  into invalid_merge
  from valuation_points
  group by target_player_id, source_id, source_player_id, valuation_date
  having count(distinct (value_amount, lower_bound, upper_bound)) > 1
  limit 1;
  if found then
    raise exception 'player identity merge % has conflicting valuation values for source %, player key %, date %',
      invalid_merge.canonical_player_id,
      invalid_merge.old_value,
      invalid_merge.canonical_value,
      invalid_merge.conflict_date;
  end if;
end;
$validation$;

-- Normalize the audited provider corrections before choosing collision
-- survivors so the merged appearances are deterministic.
update player_appearance_collision_members member
set position_name = correction.position_name,
    formation_position = correction.formation_position,
    shirt_number = null
from player_appearance_corrections correction
where member.target_player_id = correction.canonical_player_id
  and member.match_id = correction.match_id
  and member.team_id = correction.team_id;

insert into core.player_identity_redirects (
  old_player_id,
  canonical_player_id,
  old_display_name,
  canonical_display_name,
  reason
)
select
  merge.old_player_id,
  merge.canonical_player_id,
  old_player.display_name,
  canonical_player.display_name,
  merge.reason
from player_identity_merges merge
join core.players old_player on old_player.id = merge.old_player_id
join core.players canonical_player on canonical_player.id = merge.canonical_player_id
on conflict (old_player_id) do update
set canonical_player_id = excluded.canonical_player_id,
    old_display_name = excluded.old_display_name,
    canonical_display_name = excluded.canonical_display_name,
    reason = excluded.reason,
    merged_at = now();

do $enrich_canonical_players$
declare
  merge record;
begin
  for merge in
    select * from player_identity_merges order by canonical_player_id, old_player_id
  loop
    update core.players canonical_player
    set display_name_he = coalesce(nullif(canonical_player.display_name_he, ''), nullif(old_player.display_name_he, '')),
        date_of_birth = coalesce(canonical_player.date_of_birth, old_player.date_of_birth),
        country_id = coalesce(canonical_player.country_id, old_player.country_id),
        primary_position = coalesce(nullif(canonical_player.primary_position, ''), nullif(old_player.primary_position, '')),
        preferred_foot = coalesce(nullif(canonical_player.preferred_foot, ''), nullif(old_player.preferred_foot, '')),
        metadata = old_player.metadata || canonical_player.metadata
    from core.players old_player
    where canonical_player.id = merge.canonical_player_id
      and old_player.id = merge.old_player_id;
  end loop;
end;
$enrich_canonical_players$;

-- Keep one stable appearance identifier for each same-team collision while
-- filling its nullable fields and top-level metadata from the other copies.
create temporary table merged_player_appearances on commit drop as
with ranked_metadata as (
  select
    member.survivor_appearance_id,
    metadata.key,
    metadata.value,
    row_number() over (
      partition by member.survivor_appearance_id, metadata.key
      order by member.member_rank, member.appearance_id
    ) as metadata_rank
  from player_appearance_collision_members member
  cross join lateral jsonb_each(member.metadata) metadata
), merged_metadata as (
  select
    survivor_appearance_id,
    jsonb_object_agg(key, value order by key) as metadata
  from ranked_metadata
  where metadata_rank = 1
  group by survivor_appearance_id
), appearance_values as (
  select
    survivor_appearance_id,
    target_player_id,
    (array_agg(opponent_team_id order by member_rank)
      filter (where opponent_team_id is not null))[1] as opponent_team_id,
    (array_agg(side order by member_rank)
      filter (where nullif(trim(side), '') is not null))[1] as side,
    (array_agg(shirt_number order by member_rank)
      filter (where shirt_number > 0))[1] as shirt_number,
    (array_agg(lineup_status order by member_rank)
      filter (where nullif(trim(lineup_status), '') is not null))[1] as lineup_status,
    (array_agg(position_name order by member_rank)
      filter (where nullif(trim(position_name), '') is not null))[1] as position_name,
    (array_agg(formation_position order by member_rank)
      filter (where nullif(trim(formation_position), '') is not null))[1] as formation_position,
    max(minutes_played) as minutes_played
  from player_appearance_collision_members
  group by survivor_appearance_id, target_player_id
)
select
  appearance.survivor_appearance_id,
  appearance.target_player_id,
  appearance.opponent_team_id,
  appearance.side,
  appearance.shirt_number,
  appearance.lineup_status,
  appearance.position_name,
  appearance.formation_position,
  appearance.minutes_played,
  coalesce(metadata.metadata, '{}'::jsonb) as metadata
from appearance_values appearance
left join merged_metadata metadata
  on metadata.survivor_appearance_id = appearance.survivor_appearance_id;

create unique index merged_player_appearances_id_idx
  on merged_player_appearances (survivor_appearance_id);

-- Rebuild every source-specific wide-stat row for a collision. Metric columns
-- are discovered from the composite row, merged independently, and populated
-- back into the current dynamic table type.
-- obs.stat_observations has been a compatibility view over these wide rows
-- since migration 023, so its logical subject_id and player_id follow this
-- rebuild and the appearance updates below without a separate write.
create temporary table merged_player_match_stats on commit drop as
with stat_rows as (
  select
    member.survivor_appearance_id,
    stats.source_id,
    stats.appearance_id,
    stats.observed_at,
    jsonb_strip_nulls(
      to_jsonb(stats) - array['source_id', 'appearance_id', 'metric_count', 'observed_at']
    ) as metric_values
  from player_appearance_collision_members member
  join obs.player_match_stats stats on stats.appearance_id = member.appearance_id
), stat_groups as (
  select
    survivor_appearance_id,
    source_id,
    max(observed_at) as observed_at
  from stat_rows
  group by survivor_appearance_id, source_id
), ranked_metrics as (
  select
    stats.survivor_appearance_id,
    stats.source_id,
    metric.key as metric_name,
    metric.value as metric_value,
    row_number() over (
      partition by stats.survivor_appearance_id, stats.source_id, metric.key
      order by
        (
          select count(*)
          from jsonb_object_keys(stats.metric_values)
        ) desc,
        stats.observed_at desc,
        (stats.appearance_id = stats.survivor_appearance_id) desc,
        stats.appearance_id
    ) as metric_rank
  from stat_rows stats
  cross join lateral jsonb_each(stats.metric_values) metric
), metric_objects as (
  select
    survivor_appearance_id,
    source_id,
    jsonb_object_agg(metric_name, metric_value order by metric_name) as metric_values
  from ranked_metrics
  where metric_rank = 1
  group by survivor_appearance_id, source_id
), records as (
  select
    jsonb_build_object(
      'source_id', stat_group.source_id,
      'appearance_id', stat_group.survivor_appearance_id,
      'metric_count', (
        select count(*)
        from jsonb_object_keys(coalesce(metric.metric_values, '{}'::jsonb))
      ),
      'observed_at', stat_group.observed_at
    ) || coalesce(metric.metric_values, '{}'::jsonb) as data
  from stat_groups stat_group
  left join metric_objects metric
    on metric.survivor_appearance_id = stat_group.survivor_appearance_id
   and metric.source_id = stat_group.source_id
)
select (jsonb_populate_record(null::obs.player_match_stats, records.data)).*
from records;

create unique index merged_player_match_stats_source_idx
  on merged_player_match_stats (source_id, appearance_id);

update core.player_match_appearances survivor
set opponent_team_id = merged.opponent_team_id,
    side = merged.side,
    shirt_number = merged.shirt_number,
    lineup_status = merged.lineup_status,
    position_name = merged.position_name,
    formation_position = merged.formation_position,
    minutes_played = merged.minutes_played,
    metadata = merged.metadata
from merged_player_appearances merged
where survivor.id = merged.survivor_appearance_id;

delete from obs.player_match_stats stats
using player_appearance_collision_members member
where stats.appearance_id = member.appearance_id;

insert into obs.player_match_stats
select * from merged_player_match_stats;

update obs.player_appearance_observations observation
set appearance_id = member.survivor_appearance_id
from player_appearance_collision_members member
where observation.appearance_id = member.appearance_id
  and member.appearance_id <> member.survivor_appearance_id;

update obs.heatmaps heatmap
set appearance_id = member.survivor_appearance_id
from player_appearance_collision_members member
where heatmap.appearance_id = member.appearance_id
  and member.appearance_id <> member.survivor_appearance_id;

delete from core.player_match_appearances appearance
using player_appearance_collision_members member
where appearance.id = member.appearance_id
  and member.appearance_id <> member.survivor_appearance_id;

update core.player_match_appearances appearance
set player_id = merge.canonical_player_id
from player_identity_merges merge
where appearance.player_id = merge.old_player_id;

update core.player_team_stints stint
set player_id = merge.canonical_player_id
from player_identity_merges merge
where stint.player_id = merge.old_player_id;

update obs.player_appearance_observations observation
set player_id = merge.canonical_player_id
from player_identity_merges merge
where observation.player_id = merge.old_player_id;

update obs.events event
set player_id = merge.canonical_player_id
from player_identity_merges merge
where event.player_id = merge.old_player_id;

update obs.events event
set related_player_id = merge.canonical_player_id
from player_identity_merges merge
where event.related_player_id = merge.old_player_id;

update obs.heatmaps heatmap
set player_id = merge.canonical_player_id
from player_identity_merges merge
where heatmap.player_id = merge.old_player_id;

-- Collapse each projected valuation key without dropping dates. Existing
-- canonical metadata wins; missing optional metadata falls back by rank.
create temporary table merged_player_valuation_series on commit drop as
with ranked_series as (
  select
    series.*,
    row_number() over (
      partition by series.source_id, series.target_player_id, series.source_player_id
      order by
        (series.player_id = series.target_player_id) desc,
        series.observed_at desc,
        series.player_id
    ) as series_rank
  from player_valuation_collision_series series
), scalar_values as (
  select
    source_id,
    target_player_id,
    source_player_id,
    (array_agg(currency order by series_rank))[1] as currency,
    (array_agg(provider order by series_rank) filter (where provider is not null))[1] as provider,
    (array_agg(source_url order by series_rank) filter (where source_url is not null))[1] as source_url
  from ranked_series
  group by source_id, target_player_id, source_player_id
), observed_values as (
  select
    source_id,
    target_player_id,
    source_player_id,
    max(observed_at) as observed_at
  from ranked_series
  group by source_id, target_player_id, source_player_id
), ranked_points as (
  select
    series.source_id,
    series.target_player_id,
    series.source_player_id,
    point.valuation_date,
    point.value_amount,
    point.lower_bound,
    point.upper_bound,
    row_number() over (
      partition by
        series.source_id,
        series.target_player_id,
        series.source_player_id,
        point.valuation_date
      order by
        (series.player_id = series.target_player_id) desc,
        series.observed_at desc,
        series.player_id,
        point.ordinal_position desc
    ) as point_rank
  from player_valuation_collision_series series
  cross join lateral unnest(
    series.valuation_dates,
    series.value_amounts,
    series.lower_bounds,
    series.upper_bounds
  ) with ordinality as point(
    valuation_date,
    value_amount,
    lower_bound,
    upper_bound,
    ordinal_position
  )
), aggregated_points as (
  select
    source_id,
    target_player_id,
    source_player_id,
    array_agg(valuation_date order by valuation_date) as valuation_dates,
    array_agg(value_amount order by valuation_date) as value_amounts,
    array_agg(lower_bound order by valuation_date) as lower_bounds,
    array_agg(upper_bound order by valuation_date) as upper_bounds
  from ranked_points
  where point_rank = 1
  group by source_id, target_player_id, source_player_id
)
select
  scalar.source_id,
  scalar.target_player_id as player_id,
  scalar.source_player_id,
  scalar.currency,
  scalar.provider,
  scalar.source_url,
  points.valuation_dates,
  points.value_amounts,
  points.lower_bounds,
  points.upper_bounds,
  observed.observed_at
from scalar_values scalar
join aggregated_points points
  using (source_id, target_player_id, source_player_id)
join observed_values observed
  using (source_id, target_player_id, source_player_id);

delete from obs.player_valuation_series valuation
using player_valuation_collision_series collision
where valuation.source_id = collision.source_id
  and valuation.player_id = collision.player_id
  and valuation.source_player_id = collision.source_player_id;

insert into obs.player_valuation_series (
  source_id,
  player_id,
  source_player_id,
  currency,
  provider,
  source_url,
  valuation_dates,
  value_amounts,
  lower_bounds,
  upper_bounds,
  observed_at
)
select
  source_id,
  player_id,
  source_player_id,
  currency,
  provider,
  source_url,
  valuation_dates,
  value_amounts,
  lower_bounds,
  upper_bounds,
  observed_at
from merged_player_valuation_series;

-- Collision contributors are already replaced, so only noncolliding rows remain.
update obs.player_valuation_series valuation
set player_id = merge.canonical_player_id
from player_identity_merges merge
where valuation.player_id = merge.old_player_id;

update obs.player_loans loan
set player_id = merge.canonical_player_id
from player_identity_merges merge
where loan.player_id = merge.old_player_id;

update obs.team_roster_memberships roster
set player_id = merge.canonical_player_id
from player_identity_merges merge
where roster.player_id = merge.old_player_id;

update source.source_entity_ids mapping
set canonical_table = 'core.players',
    canonical_id = merge.canonical_player_id,
    mapping_status = 'manual',
    confidence = 1,
    last_seen_at = now(),
    metadata = mapping.metadata || jsonb_build_object(
      'identity_merge', true,
      'identity_merge_reason', merge.reason,
      'identity_merge_previous_id', merge.old_player_id
    )
from player_identity_merges merge
where mapping.entity_type = 'player'
  and mapping.canonical_id = merge.old_player_id;

delete from core.players player
using player_identity_merges merge
where player.id = merge.old_player_id;

do $post_merge_validation$
begin
  if exists (
    select 1
    from player_identity_merges merge
    join core.players player on player.id = merge.old_player_id
  ) then
    raise exception 'merged player identities still exist in core.players';
  end if;

  if exists (
    select 1
    from player_identity_merges merge
    join source.source_entity_ids mapping
      on mapping.entity_type = 'player'
     and mapping.canonical_id = merge.old_player_id
  ) then
    raise exception 'source mappings still point at merged player identities';
  end if;

  if exists (
    select 1
    from core.player_match_appearances appearance
    where appearance.player_id in (
      select canonical_player_id from player_identity_merges
    )
    group by appearance.match_id, appearance.player_id
    having count(*) > 1
  ) then
    raise exception 'player identity merge created duplicate match appearances';
  end if;
end;
$post_merge_validation$;

notify pgrst, 'reload schema';
