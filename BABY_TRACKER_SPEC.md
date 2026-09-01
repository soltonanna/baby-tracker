# Baby Tracker — Product & Technical Specification

## 1. О проекте

**Baby Tracker** — веб-приложение для ведения ежедневного журнала младенца/младенцев, с особым фокусом на семью с близнецами.

Основная идея приложения:

> Помочь родителям не держать в голове огромное количество информации о двух детях одновременно, быстро фиксировать события и видеть историю, динамику и важные напоминания в одном месте.

Приложение должно быть простым для использования с телефона одной рукой, поскольку основной пользователь часто будет использовать его во время кормления, укачивания или ухода за ребёнком.

Главная особенность продукта — **Twin Mode**: приложение изначально проектируется так, чтобы поддерживать двух детей, при этом каждый ребёнок имеет отдельную медицинскую и developmental history.

---

# 2. Цели проекта

## Основные цели

1. Быстро записывать ежедневные события.
2. Отдельно хранить данные каждого ребёнка.
3. Уметь одновременно записывать событие для обоих детей.
4. Отслеживать сон, кормление, подгузники и другие ежедневные события.
5. Отслеживать рост и вес.
6. Хранить медицинскую историю.
7. Вести календарь врачей и вакцинаций.
8. Хранить назначения и лекарства.
9. Отслеживать milestones развития.
10. Показывать статистику и динамику.
11. Давать родителям понятный daily summary.
12. В будущем добавить AI Assistant, который сможет анализировать накопленные данные, но не ставить диагнозы.

---

# 3. Целевая аудитория

Основной пользователь:

* родитель новорождённого;
* родитель двух детей;
* особенно родители близнецов.

Вторичные пользователи:

* второй родитель;
* бабушки/дедушки;
* няня или другой caregiver.

---

# 4. Главный принцип UX

Приложение не должно заставлять родителя заполнять длинные формы.

Основное действие должно занимать **1–3 нажатия**.

Например:

```text
Сегодня

👦 Мальчик
👧 Девочка

[ 🍼 Кормление ]
[ 😴 Сон ]
[ 💧 Подгузник ]
[ 🌡 Температура ]
[ 💊 Лекарство ]
[ 📝 Заметка ]
```

После нажатия:

```text
Кто?

○ Мальчик
○ Девочка
● Оба
```

После этого создаётся запись.

---

# 5. Twin Mode

Это ключевая функциональность приложения.

Каждое событие может относиться:

* только к ребёнку A;
* только к ребёнку B;
* одновременно к обоим.

Например:

```text
🍼 10:00

👦 Мальчик — 10:00
👧 Девочка — 10:05
```

Или:

```text
🛁 19:00

👦 + 👧
```

Приложение должно позволять создавать связанные события для обоих детей.

При этом данные детей никогда не должны смешиваться.

---

# 6. Profiles

Каждый ребёнок имеет собственный профиль.

## Baby Profile

Поля:

* имя;
* пол;
* дата рождения;
* время рождения;
* место рождения;
* вес при рождении;
* рост при рождении;
* окружность головы при рождении;
* группа крови — опционально;
* срок беременности;
* фотография;
* заметки.

Для близнецов:

```text
Baby A
Baby B
```

В дальнейшем пользователь может изменить имена.

---

# 7. Dashboard

Главный экран должен показывать информацию за текущий день.

Пример:

```text
Good morning ☀️

September 1

👦 Baby A
🍼 5 feedings
😴 3 sleeps
💧 5 diapers

👧 Baby B
🍼 5 feedings
😴 3 sleeps
💧 6 diapers

Next:
🍼 approximately 12:30
```

Также:

* последнее кормление;
* последний сон;
* последний подгузник;
* текущий вес;
* ближайшее событие;
* ближайший appointment.

---

# 8. Daily Events

Основная модель приложения — события.

Каждое событие должно иметь:

```text
id
babyId
type
timestamp
duration
data
createdBy
createdAt
updatedAt
```

Типы событий:

```text
feeding
sleep
diaper
bath
temperature
medication
pumping
bottle
note
```

Архитектура должна позволять добавлять новые типы событий без переписывания всей системы.

---

# 9. Feeding

Поддержать:

### Breastfeeding

* start time;
* end time;
* duration;
* left/right/both;
* optional note.

### Bottle

* breast milk;
* formula;
* other;
* amount in ml;
* bottle type;
* note.

Важно:

Не делать медицинских рекомендаций по объёму или частоте кормлений.

Приложение только хранит данные.

---

# 10. Sleep

Записывать:

* start;
* end;
* duration;
* daytime/nighttime;
* location;
* note.

Приложение автоматически рассчитывает:

* длительность каждого сна;
* суммарный дневной сон;
* суммарный сон за 24 часа;
* количество sleep sessions.

Для близнецов показывать:

```text
👦 09:00–10:10
👧 09:05–10:20

Synced sleep: 65 minutes
```

---

# 11. Diapers

Максимально простой интерфейс.

Типы:

```text
wet
dirty
wet_and_dirty
dry
```

Можно добавить дополнительные поля позже.

Daily summary:

```text
👦
💧 7
💩 3

👧
💧 8
💩 2
```

---

# 12. Growth

Отдельный раздел.

Для каждого ребёнка:

* weight;
* height;
* head circumference;
* date;
* optional note.

Графики:

```text
Weight
Height
Head circumference
```

Показывать:

* текущий показатель;
* изменение с предыдущего измерения;
* динамику во времени.

В будущем можно добавить WHO growth charts.

Не делать выводов о здоровье только на основании графика.

---

# 13. Medical History

Каждый ребёнок имеет собственную медицинскую историю.

## Doctors

Запись:

```text
doctor
specialty
date
reason
notes
recommendations
attachments
```

Специализации:

* pediatrician;
* neurologist;
* orthopedist;
* ophthalmologist;
* dentist;
* other.

---

# 14. Vaccinations

Раздел:

```text
Vaccinations

👦 Baby A

✓ Vaccine 1
✓ Vaccine 2
○ Vaccine 3

👧 Baby B

✓ Vaccine 1
✓ Vaccine 2
○ Vaccine 3
```

Функции:

* vaccine name;
* date;
* dose;
* doctor/clinic;
* batch number — optional;
* notes;
* document/photo.

Не зашивать календарь вакцинации непосредственно в бизнес-логику.

Система должна поддерживать configurable vaccination schedules.

---

# 15. Appointments

Календарь:

```text
September 2026

05 — Pediatrician
12 — Vaccination
20 — Orthopedist
```

Appointment:

* date;
* time;
* doctor;
* specialty;
* location;
* child;
* both children;
* notes;
* reminder.

---

# 16. Medications

Хранить:

* medicine name;
* child;
* dosage — как введено пользователем/врачом;
* frequency;
* start date;
* end date;
* doctor;
* notes.

Важно:

Приложение НЕ должно самостоятельно рассчитывать медицинские дозировки и НЕ должно заменять врача.

Оно является журналом и системой напоминаний.

---

# 17. Milestones

Раздел развития.

Категории:

### Motor

* head control;
* rolling;
* sitting;
* crawling;
* standing;
* walking.

### Communication

* smiling;
* responding to sounds;
* babbling;
* first words.

### Social

* eye contact;
* recognizing parents;
* social interaction.

Пользователь отмечает milestone:

```text
✓ Achieved

Date: September 20
Note: ...
```

Каждый ребёнок имеет отдельную историю.

Не сравнивать детей в формате:

> "Baby A развивается лучше Baby B."

Можно показывать только фактическую историю каждого ребёнка.

---

# 18. Documents

Возможность прикреплять документы:

* ultrasound;
* hospital discharge;
* laboratory results;
* doctor reports;
* vaccination certificates;
* prescriptions.

Документы должны быть привязаны к:

* ребёнку;
* medical event;
* appointment;
* vaccination.

---

# 19. Family / Caregivers

Один аккаунт может иметь family.

Роли:

```text
Owner
Parent
Caregiver
```

Owner может:

* добавлять детей;
* приглашать пользователей;
* управлять доступом.

Parent:

* полный доступ к данным детей.

Caregiver:

* может добавлять daily events;
* не имеет доступа к критичным настройкам семьи.

В будущем permissions можно расширить.

---

# 20. Daily Summary

В конце дня приложение формирует summary.

Пример:

```text
September 1

👦 Baby A

🍼 Feedings: 8
😴 Sleep: 13h 20m
💧 Wet diapers: 7
💩 Dirty diapers: 2

👧 Baby B

🍼 Feedings: 8
😴 Sleep: 13h 05m
💧 Wet diapers: 8
💩 Dirty diapers: 3

👯 Twin sync

6 synchronized feedings
4 synchronized sleep sessions
```

Summary должно быть информативным, но не медицинским заключением.

---

# 21. Analytics

Analytics page:

### Feeding

* feedings per day;
* average interval;
* total bottle volume;
* breastfeeding duration.

### Sleep

* total sleep;
* daytime sleep;
* nighttime sleep;
* number of sessions.

### Diapers

* wet;
* dirty;
* combined.

### Growth

* weight;
* height;
* head circumference.

Главная идея:

Показывать **динамику**, а не только отдельные значения.

---

# 22. Smart Insights

В будущем можно добавить автоматические наблюдения.

Например:

```text
💡 Observation

Baby A had 2 more sleep sessions today
than the average of the previous 7 days.
```

или:

```text
💡 Observation

The twins were fed at approximately
the same time in 6 of the last 8 feedings.
```

Это должны быть нейтральные наблюдения.

Нельзя писать:

> "Your baby has a sleep problem."

или

> "Your baby is dehydrated."

Любые медицинские выводы должны оставаться за врачом.

---

# 23. AI Assistant

AI Assistant — отдельный модуль, который можно реализовать после основной версии.

Пользователь может спросить:

> "Как сегодня прошёл день?"

AI получает данные из журнала и формирует summary.

Также:

> "Когда мальчик последний раз ел?"

> "Сколько оба ребёнка спали сегодня?"

> "Покажи вес девочки за последний месяц."

> "Какие прививки нам предстоят?"

AI должен отвечать только на основании доступных данных.

Для медицинских вопросов:

* не ставить диагноз;
* не назначать лекарства;
* не менять дозировки;
* не выдавать опасные рекомендации;
* при необходимости рекомендовать обратиться к педиатру.

---

# 24. Notifications

Типы уведомлений:

* appointment;
* vaccination;
* medication;
* custom reminder.

Например:

```text
🔔 Tomorrow at 10:00

Pediatrician appointment
👦 + 👧
```

Не создавать чрезмерное количество уведомлений.

---

# 25. Localization

Первоначально:

* Russian;
* English.

Архитектура должна поддерживать добавление других языков.

Не хранить пользовательские тексты непосредственно в коде интерфейса.

Использовать i18n.

---

# 26. Units

Поддержать:

* kg / lb;
* cm / inch;
* ml / oz.

Настройки пользователя должны определять единицы измерения.

---

# 27. Authentication

Предусмотреть:

* registration;
* login;
* logout;
* password reset;
* session/token management.

В дальнейшем:

* Google login;
* Apple login.

---

# 28. Backend

Предпочтительная архитектура:

```text
Frontend
React + TypeScript

Backend
Node.js
TypeScript

Database
MongoDB
```

Backend должен иметь REST API.

Основные домены:

```text
auth
users
families
babies
events
feeding
sleep
diapers
growth
medical
vaccinations
appointments
medications
milestones
documents
notifications
analytics
ai
```

Не нужно создавать отдельный backend domain для каждого маленького типа события, если это приводит к избыточной архитектуре.

---

# 29. MongoDB

Основные коллекции:

```text
users
families
babies
events
growth_records
medical_records
vaccinations
appointments
medications
milestones
documents
notifications
```

Важно:

Данные должны быть разделены по familyId.

Каждый запрос к данным должен проверять ownership/access.

Нельзя допускать получение данных ребёнка другой семьи простым изменением babyId в API request.

---

# 30. Frontend Structure

Предпочтительно использовать feature-based structure.

Пример:

```text
src/

  app/

  components/

  features/
    dashboard/
    babies/
    feeding/
    sleep/
    diapers/
    growth/
    medical/
    vaccinations/
    appointments/
    medications/
    milestones/
    analytics/
    ai/

  hooks/

  services/

  types/

  utils/

  i18n/
```

Не создавать огромные компоненты по 500–1000 строк.

---

# 31. Mobile-first

Основной сценарий использования — телефон.

Desktop должен поддерживаться, но mobile UX имеет приоритет.

Особенно важно:

* большие touch targets;
* минимум текста при быстром вводе;
* быстрые действия;
* bottom navigation;
* floating action button для добавления события;
* возможность использовать приложение одной рукой.

---

# 32. Offline-first — желательно

Поскольку родитель может быть:

* в поликлинике;
* в дороге;
* без интернета;
* в больнице.

Желательно предусмотреть локальное сохранение событий.

Минимальная версия:

```text
Create event
↓
Save locally
↓
Sync with server
```

При конфликте использовать timestamp + server reconciliation.

Это можно реализовать после MVP.

---

# 33. MVP

Первая версия НЕ должна содержать всё.

MVP:

### Authentication

* login;
* registration.

### Family

* family;
* two babies.

### Daily Tracker

* feeding;
* sleep;
* diapers;
* notes.

### Growth

* weight;
* height.

### Medical

* doctors;
* appointments;
* vaccinations.

### Dashboard

* today's events;
* summary.

### Twin Mode

* Baby A;
* Baby B;
* Both.

Этого достаточно для первой рабочей версии.

---

# 34. Version 2

После MVP:

* medications;
* milestones;
* documents;
* notifications;
* analytics;
* better growth charts;
* family caregivers;
* offline support.

---

# 35. Version 3

После стабилизации:

* AI Assistant;
* AI daily summary;
* smart insights;
* configurable vaccination schedules;
* advanced analytics;
* export PDF;
* export medical history;
* sharing information with doctor.

---

# 36. Не делать на первом этапе

Не нужно сразу создавать:

* сложную социальную сеть;
* community;
* public profiles;
* marketplace;
* e-commerce;
* complicated medical decision support;
* automatic diagnosis;
* complicated AI;
* dozens of integrations.

Главный приоритет:

> **Fast logging + reliable history + twin synchronization.**

---

# 37. Privacy & Security

Данные приложения являются приватными.

Особенно чувствительные данные:

* медицинская информация;
* документы;
* фотографии;
* данные детей.

Необходимо:

* authentication;
* authorization;
* family-level access control;
* secure API;
* validation;
* input sanitization;
* protected document access;
* no public medical data.

Shareable links должны быть отдельной opt-in функцией и не должны открывать всю медицинскую историю без явного разрешения пользователя.

---

# 38. Product Philosophy

Приложение должно следовать следующим принципам:

### 1. Simple

Родитель не должен заполнять анкету ради одной записи.

### 2. Fast

Основные действия должны занимать секунды.

### 3. Reliable

История не должна теряться.

### 4. Twin-first

Двойня — не дополнительная функция поверх single-baby tracker.

Она должна быть заложена в архитектуру.

### 5. Data-driven

Приложение помогает увидеть историю и динамику.

### 6. Non-medical

Приложение не заменяет врача.

---

# 39. Основной пользовательский сценарий

После рождения детей пользователь открывает приложение.

```text
Dashboard

👦 Baby A
👧 Baby B

[🍼] [😴] [💧] [📝]
```

Нажимает:

```text
🍼
```

Выбирает:

```text
👦
👧
👯 BOTH
```

Вводит необходимые данные.

Нажимает Save.

Событие появляется в Timeline.

В конце дня Dashboard показывает summary.

Со временем данные формируют:

```text
Timeline
↓
Statistics
↓
Growth
↓
Medical history
↓
Insights
```

---

# 40. Основная задача Claude при разработке

Claude должен выступать как senior full-stack developer и product engineer.

Перед написанием большого количества кода:

1. Анализировать существующую архитектуру.
2. Предлагать план.
3. Разбивать работу на небольшие задачи.
4. Не менять архитектуру без причины.
5. Не создавать ненужную сложность.
6. Использовать TypeScript.
7. Писать типизированный код.
8. Валидировать API input.
9. Учитывать authorization.
10. Писать код, который можно поддерживать.

При добавлении новой функции:

```text
1. Explain architecture
2. Define data model
3. Define API
4. Define frontend types
5. Implement backend
6. Implement frontend
7. Add validation
8. Test
9. Review edge cases
```

---

# 41. Правило разработки

Не пытаться построить весь продукт сразу.

Работать итерациями:

```text
Feature
↓
Model
↓
API
↓
UI
↓
Validation
↓
Testing
↓
Review
↓
Next feature
```

После каждой крупной функции приложение должно оставаться рабочим.

---

# 42. Первоначальный roadmap

## Phase 1 — Foundation

* project setup;
* authentication;
* database;
* family;
* babies;
* basic layout;
* navigation.

## Phase 2 — Daily Tracker

* feeding;
* sleep;
* diapers;
* notes;
* timeline.

## Phase 3 — Twin Mode

* both babies;
* synchronized events;
* combined dashboard;
* twin statistics.

## Phase 4 — Health

* growth;
* doctors;
* appointments;
* vaccinations.

## Phase 5 — Analytics

* charts;
* daily summary;
* weekly summary.

## Phase 6 — Family

* caregivers;
* permissions.

## Phase 7 — Advanced

* notifications;
* documents;
* milestones;
* offline.

## Phase 8 — AI

* AI assistant;
* summaries;
* natural-language queries;
* smart observations.

---

# 43. Definition of Done

Функция считается завершённой только если:

* frontend работает;
* backend работает;
* данные сохраняются;
* данные корректно загружаются;
* есть validation;
* есть authorization;
* есть loading state;
* есть error state;
* mobile UI работает;
* нет очевидных race conditions;
* данные одного ребёнка не смешиваются с другим;
* существующие функции не сломаны.

---

# 44. Главная идея продукта

Это не просто:

> "приложение для записи кормлений".

Это:

> **Personal digital journal and family management system for raising babies, designed from the ground up for twins.**

Основная ценность:

**родителю не нужно помнить — приложение помнит за него.**
